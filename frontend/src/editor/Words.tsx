import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors } from 'lucide-react';
import { tokenTime, type Token } from '../timeline/words';
import type { Clip } from '../timeline/model';

export const LANGUAGES = [{ id: 'auto', label: 'Detect language' }, { id: 'ta', label: 'Tamil' }, { id: 'en', label: 'English' }, { id: 'hi', label: 'Hindi' }, { id: 'te', label: 'Telugu' }, { id: 'ml', label: 'Malayalam' }, { id: 'kn', label: 'Kannada' }];

type Props = {
  tokens: Token[]; clips: Clip[]; language: string; onLanguage: (language: string) => void; missing: number; busy: string | null; hasTracks: boolean; locked: boolean;
  onTranscribe: () => void; onCancel: () => void; onSeek: (t: number) => void; onCut: (keys: Set<string>) => void; onMenu: (event: React.MouseEvent, keys: Set<string>) => void; playhead: { current: number };
  selection: Set<string>; onSelection: (keys: Set<string>) => void;
};

/** The transcript. Selecting words and pressing Delete cuts them from the video. */
export function WordsPanel({ tokens, clips, language, onLanguage, missing, busy, hasTracks, locked, onTranscribe, onCancel, onSeek, onCut, onMenu, playhead, selection, onSelection }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const [dragged, setDragged] = useState(false);
  const clipFor = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const pauses = useMemo(() => new Set(tokens.filter((token) => !token.text).map((token) => token.key)), [tokens]);
  const timeOf = useCallback((token: Token, source: number) => tokenTime(clipFor.get(token.clipId)!, source), [clipFor]);
  const selectRange = (index: number) => {
    const start = Math.min(anchor.current ?? index, index); const end = Math.max(anchor.current ?? index, index);
    onSelection(new Set(tokens.slice(start, end + 1).map((token) => token.key)));
  };
  // The word being spoken lights up without redrawing the panel.
  useEffect(() => {
    let frame = 0; let lit: Element | null = null; let last = -1;
    const follow = () => {
      frame = requestAnimationFrame(follow);
      if (playhead.current === last) return;
      last = playhead.current;
      const index = tokens.findIndex((token) => { const clip = clipFor.get(token.clipId); return clip && playhead.current >= tokenTime(clip, token.from) && playhead.current < tokenTime(clip, token.to); });
      const next = index >= 0 ? box.current?.querySelector(`[data-index="${index}"]`) ?? null : null;
      if (next !== lit) { lit?.classList.remove('now'); next?.classList.add('now'); lit = next; next?.scrollIntoView({ block: 'nearest' }); }
    };
    follow();
    return () => { cancelAnimationFrame(frame); lit?.classList.remove('now'); };
  }, [tokens, clipFor, playhead]);
  const words = tokens.filter((token) => token.text).length;
  return <div className="ed-words">
    <label className="ed-words-language"><span>Spoken language</span><select value={language} disabled={Boolean(busy)} onChange={(event) => onLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {busy ? <><p className="ed-tip">{busy}</p><button className="ed-button wide" onClick={onCancel}>Cancel</button></>
      : missing > 0 ? <button className="ed-primary wide" onClick={onTranscribe}>Transcribe {missing} clip{missing === 1 ? '' : 's'}</button> : null}
    {!tokens.length && !busy && <p className="ed-tip">{missing ? 'Motion listens to your video on this Mac and writes out the words. Nothing is uploaded.' : clips.length ? 'No speech found in your clips.' : 'Add a video to the timeline first.'}</p>}
    {tokens.length > 0 && <>
      <div className="ed-words-bar">{selection.size > 0
        ? <button className="ed-primary" disabled={locked} onClick={() => onCut(selection)}><Scissors size={14}/>Cut {selection.size === 1 ? 'selection' : `${selection.size} items`}</button>
        : <><span className="ed-tip">{words} words</span>{pauses.size > 0 && <button className="ed-button" disabled={locked} onClick={() => onCut(pauses)} title="Shorten every long pause">Remove {pauses.size} pause{pauses.size === 1 ? '' : 's'}</button>}</>}</div>
      <div className="ed-script" ref={box} role="listbox" aria-multiselectable="true" aria-label="Transcript"
        onPointerUp={() => { dragging.current = false; setDragged(false); }} onPointerLeave={() => { dragging.current = false; }}>
        {tokens.map((token, index) => <button key={token.key} data-index={index} role="option" aria-selected={selection.has(token.key)} className={`${token.text ? 'word' : 'pause'} ${selection.has(token.key) ? 'on' : ''} ${dragged ? 'dragging' : ''}`}
          title={token.text ? undefined : `Pause of ${(token.to - token.from).toFixed(1)} seconds`}
          onPointerDown={(event) => { if (event.button !== 0 || event.ctrlKey) return; if (!event.shiftKey) anchor.current = index; dragging.current = true; event.currentTarget.releasePointerCapture?.(event.pointerId); selectRange(index); onSeek(timeOf(token, token.from)); }}
          onPointerEnter={() => { if (dragging.current) { setDragged(true); selectRange(index); } }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const keys = selection.has(token.key) ? selection : new Set([token.key]); if (keys !== selection) { anchor.current = index; onSelection(keys); } onMenu(event, keys); }}>
          {token.text ?? `⏸ ${(token.to - token.from).toFixed(1)}s`}</button>)}
      </div>
      <p className="ed-tip">Click a word to jump to it. Drag or Shift-click to select, then press Delete to cut.{hasTracks ? ' Titles, overlays and separate sounds stay where they are.' : ''}</p>
    </>}
  </div>;
}
