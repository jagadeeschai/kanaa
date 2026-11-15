import { fetchRecorded,getSongBeats } from "../../api/client";
import { valueAt } from "../../timeline/evaluate";
import { addBlur,addText,cinemaRevealShape,clipLength,findText,groundShape,mainLayer,markOwn,putBehindShape,REST_TRANSFORM,sharedKeys,updateText,type CinemaReveal,type Clip,type ShapeMask,type TextItem,type Timeline } from "../../timeline/model";
import { addTemplateEffects,cinematicJoinFor,cinematicJoinTime,dateWords,defocusBox,fromTemplate,isDateTemplate,lookOf,MAX_SAVED,motionOf,saveStyles,type Template } from "../../timeline/templates";
import { newId,SHAPE_FEATHER,TEXT_SECONDS } from "../editor-constants";
import { PlaybackEngine } from "../playback";

type Input = {
  addEffect: (effectId: string, dropAt?: number, length?: number, around?: Partial<Clip["transform"]>) => Promise<void>;
  change: (next: Timeline, group?: string | null) => void;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  moreIds: ReadonlySet<string>;
  myStyles: Template[];
  now: number;
  scopedUpdate: <T extends object>(id: string, changes: T, one: (t: Timeline) => Timeline, group?: string) => void;
  selectedText: TextItem | null;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setMyStyles: React.Dispatch<React.SetStateAction<Template[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setShaping: React.Dispatch<React.SetStateAction<{ textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null>>;
  shaping: { textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null;
  styleScope: "item" | "layer";
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createTitleEditingActions(getInput: () => Input) {
  const updateSelectedText = (...args: Parameters<(changes: Partial<TextItem>, group?: string) => void>) => {
    const { timeline, selectedText, moreIds, styleScope, change, scopedUpdate } = getInput();
    const invoke = (changes: Partial<TextItem>, group?: string) => {
    if (timeline && selectedText && moreIds.size && styleScope === 'item') {
      // Several titles picked: the change goes to each of them (never their words or timing).
      const shared = Object.fromEntries(Object.entries(changes).filter(([key]) => sharedKeys({ [key]: 0 }).length)) as Partial<TextItem>;
      let next = updateText(timeline, selectedText.id, changes);
      for (const id of moreIds) if (findText(next, id) && Object.keys(shared).length) next = markOwn(updateText(next, id, shared), id, shared);
      change(markOwn(next, selectedText.id, changes), group);
      return;
    }
    if (timeline && selectedText) scopedUpdate(selectedText.id, changes, (t) => updateText(t, selectedText.id, changes), group);
  };
    return invoke(...args);
  };

  const saveStyle = (...args: Parameters<(text: TextItem) => void>) => {
    const { myStyles, setMyStyles } = getInput();
    const invoke = (text: TextItem) => {
    const style: Template = { id: `mine-${Date.now().toString(36)}`, label: text.text.slice(0, 18), look: lookOf(text), motion: motionOf(text) };
    const next = [style, ...myStyles].slice(0, MAX_SAVED);
    setMyStyles(next); saveStyles(next);
  };
    return invoke(...args);
  };

  const forgetStyle = (...args: Parameters<(id: string) => void>) => {
    const { myStyles, setMyStyles } = getInput();
    const invoke = (id: string) => { const next = myStyles.filter((style) => style.id !== id); setMyStyles(next); saveStyles(next); };
    return invoke(...args);
  };

  const addTitle = (...args: Parameters<(title: Template, dropAt?: number, words?: string) => Promise<void>>) => {
    const { timeline, engineRef, setError, timelineRef, change, addEffect, setSelectedId } = getInput();
    const invoke = async (title: Template, dropAt?: number, words?: string) => {
    if (!timeline) return;
    const at = dropAt ?? engineRef.current?.currentTime ?? 0;
    // A date title says when the clip under it was filmed (or the photo taken); today when the file doesn't say.
    let dated: Partial<TextItem> = {};
    if (isDateTemplate(title.id) && !words) {
      const under = mainLayer(timeline).items.find((item) => item.start <= at && at < item.start + clipLength(item));
      const recorded = under ? await fetchRecorded(under.media_id).catch(() => null) : null;
      dated = dateWords(recorded, title.id === 'date-tamil' ? 'ta' : 'en');
      if (!recorded) setError(under ? 'This clip doesn\'t say when it was filmed, so the title shows today\'s date. Type the right one.' : 'No clip here, so the title shows today\'s date.');
    }
    const current = timelineRef.current ?? timeline;
    const text: TextItem = { ...fromTemplate(title, newId(), title.extra?.transition ? cinematicJoinTime(current,at) : Math.round(at * 1000) / 1000, TEXT_SECONDS), ...dated, ...(words ? { text: words, subtitle: '' } : {}) };
    let next = cinematicJoinFor(title, addText(current, text, newId()), text.start);
    // Pull focus: the picture behind softens while the title sharpens.
    if (title.extra?.defocus) next = addBlur(next, defocusBox(newId(), text.start, text.length, text.enter?.duration ?? 1, text.exit?.duration ?? 0.6), newId());
    change(next);
    // A title that brings an effect (lens flare, sparkles, bokeh) lays it over the video for the title's length.
    void addTemplateEffects(title, text.start, text.length, addEffect, current, getSongBeats);
    setSelectedId(text.id);
    // A title starts hidden behind its enter animation, so show it at rest.
    setTimeout(() => engineRef.current?.seek(text.start + TEXT_SECONDS / 2), 0);
  };
    return invoke(...args);
  };

  const finishShape = (...args: Parameters<() => void>) => {
    const { timeline, shaping, setError, setShaping, change } = getInput();
    const invoke = () => {
    if (!timeline || !shaping) return;
    const enough = shaping.mode === 'ground' ? shaping.points.length >= 2 : shaping.points.length >= 3;
    if (!enough) { setError(shaping.mode === 'ground' ? 'Click at least two points along the top of the ground.' : 'Click at least three points around the shape.'); return; }
    const mask: ShapeMask = { points: shaping.mode === 'ground' ? groundShape(shaping.points) : shaping.points, feather: SHAPE_FEATHER };
    const next = shaping.reveal
      ? cinemaRevealShape(timeline, shaping.textId, shaping.reveal, mask, [newId(), newId()])
      : putBehindShape(timeline, shaping.textId, mask, [newId(), newId()]);
    setShaping(null);
    if (next === timeline) setError('Put the title over a video clip or picture on the main track first.'); else change(next);
  };
    return invoke(...args);
  };

  const titleRect = (...args: Parameters<(text: TextItem) => { left: number; top: number; right: number; bottom: number; } | null>) => {
    const { engineRef, now } = getInput();
    const invoke = (text: TextItem): { left: number; top: number; right: number; bottom: number } | null => {
    const box = engineRef.current?.titleBox(text);
    if (!box) return null;
    const transform = text.transform ?? REST_TRANSFORM, at = Math.max(0, Math.min(text.length, now - text.start));
    const x = valueAt(transform, 'x', at), y = valueAt(transform, 'y', at), size = valueAt(transform, 'scale', at);
    return { left: x + (box[0] - 0.5) * size, top: y + (box[1] - 0.5) * size, right: x + (box[2] - 0.5) * size, bottom: y + (box[3] - 0.5) * size };
  };
    return invoke(...args);
  };

  const decorateTitle = (...args: Parameters<(effectId: "bubbles" | "shine") => void>) => {
    const { selectedText, addEffect } = getInput();
    const invoke = (effectId: 'bubbles' | 'shine') => {
    if (!selectedText) return;
    const rect = titleRect(selectedText);
    const [cx, cy, wide] = rect ? [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2, rect.right - rect.left] : [selectedText.transform?.x ?? 0.5, selectedText.position === 'bottom' ? 0.85 : selectedText.position === 'top' ? 0.15 : 0.5, 0.5];
    // Bubbles rise from a little below the words and need room; the shine only crosses the letters.
    const scale = Math.min(1, Math.max(0.2, wide * (effectId === 'bubbles' ? 1.4 : 1.15)));
    void addEffect(effectId, selectedText.start, selectedText.length, { x: Math.round(cx * 1000) / 1000, y: Math.round((effectId === 'bubbles' ? cy - 0.05 : cy) * 1000) / 1000, scale: Math.round(scale * 1000) / 1000 });
  };
    return invoke(...args);
  };

  const titleAt = (...args: Parameters<(fx: number, fy: number) => TextItem | null>) => {
    const { timeline, now } = getInput();
    const invoke = (fx: number, fy: number): TextItem | null => {
    if (!timeline) return null;
    const layers = timeline.layers.filter((layer): layer is Extract<typeof layer, { kind: 'text' }> => layer.kind === 'text' && !layer.hidden).reverse();  // Topmost first.
    for (const layer of layers) for (const text of layer.items) {
      if (now < text.start || now >= text.start + text.length) continue;
      const rect = titleRect(text);
      if (rect && fx >= rect.left - 0.01 && fx <= rect.right + 0.01 && fy >= rect.top - 0.01 && fy <= rect.bottom + 0.01) return text;
    }
    return null;
  };
    return invoke(...args);
  };
  return { saveStyle, forgetStyle, addTitle, updateSelectedText, titleRect, decorateTitle, titleAt, finishShape };
}
