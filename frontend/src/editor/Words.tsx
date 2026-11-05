import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Sparkles } from 'lucide-react';
import { tokenTime, type Tidy, type Token } from '../timeline/words';
import type { Clip } from '../timeline/model';
import KanaaSelect from '../components/KanaaSelect';

export const LANGUAGES = [{ id: 'auto', label: 'Detect language' }, { id: 'ta', label: 'Tamil' }, { id: 'en', label: 'English' }, { id: 'hi', label: 'Hindi' }, { id: 'te', label: 'Telugu' }, { id: 'ml', label: 'Malayalam' }, { id: 'kn', label: 'Kannada' }];

type Props = {
  tokens: Token[]; clips: Clip[]; language: string; onLanguage: (language: string) => void; missing: number; busy: string | null; hasTracks: boolean; locked: boolean;
  onTranscribe: () => void; onCancel: () => void; onSeek: (t: number) => void; onCut: (keys: Set<string>) => void; onMenu: (event: React.MouseEvent, keys: Set<string>) => void; playhead: { current: number };
  selection: Set<string>; onSelection: (keys: Set<string>) => void;
  tidy: Tidy | null; pauseLength: number; onPauseLength: (seconds: number) => void; fillers: boolean; onFillers: (on: boolean) => void; onTidy: () => void;
};

export const PAUSE_LENGTHS = [0.4, 0.7, 1];

/** The transcript. Selecting words and pressing Delete cuts them from the video. */
export function WordsPanel({ tokens, clips, language, onLanguage, missing, busy, hasTracks, locked, onTranscribe, onCancel, onSeek, onCut, onMenu, playhead, selection, onSelection, tidy, pauseLength, onPauseLength, fillers, onFillers, onTidy }: Props) {
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
    <label className="ed-words-language"><span>Spoken language</span><KanaaSelect aria-label="Spoken language" value={language} disabled={Boolean(busy)} onChange={(event) => onLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</KanaaSelect></label>
    {busy ? <><p className="ed-tip">{busy}</p><button className="ed-button wide" onClick={onCancel}>Cancel</button></>
      : missing > 0 ? <button className="ed-primary wide" onClick={onTranscribe}>Transcribe {missing} clip{missing === 1 ? '' : 's'}</button> : null}
    {!tokens.length && !busy && <p className="ed-tip">{missing ? 'Kanaa listens to your video on this Mac and writes out the words. Nothing is uploaded.' : clips.length ? 'No speech found in your clips.' : 'Add a video to the timeline first.'}</p>}
    {tokens.length > 0 && tidy && <section className="ed-tidy" aria-label="Remove pauses">
      <h3 className="ed-sub">Remove pauses</h3>
      <div className="ed-add-row"><span>Pauses longer than</span><div className="ed-chips ed-even three" role="group" aria-label="Shortest pause to remove">{PAUSE_LENGTHS.map((seconds) => <button key={seconds} className={pauseLength === seconds ? 'on' : ''} aria-pressed={pauseLength === seconds} onClick={() => onPauseLength(seconds)}>{seconds}s</button>)}</div></div>
      <label className="ed-check"><input type="checkbox" checked={fillers} onChange={(event) => onFillers(event.target.checked)}/><span>Also remove “um” and “uh”</span></label>
      <p className="ed-tip" role="status">{tidy.keys.size ? `${[tidy.pauses ? `${tidy.pauses} pause${tidy.pauses === 1 ? '' : 's'}` : '', tidy.fillers ? `${tidy.fillers} filler${tidy.fillers === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}, about ${tidy.seconds.toFixed(1)} seconds shorter. A short breath stays at each cut.` : 'Nothing to remove at this length.'}</p>
      <button className="ed-primary wide" disabled={locked || !tidy.keys.size} onClick={onTidy}><Sparkles size={14}/>Remove pauses</button>
    </section>}
    {tokens.length > 0 && <>
      <div className="ed-words-bar">{selection.size > 0
        ? <button className="ed-primary" disabled={locked} onClick={() => onCut(selection)}><Scissors size={14}/>Cut {selection.size === 1 ? 'selection' : `${selection.size} items`}</button>
        : <span className="ed-tip">{words} words{pauses.size ? `, ${pauses.size} long pause${pauses.size === 1 ? '' : 's'}` : ''}</span>}</div>
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
