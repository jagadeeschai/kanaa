/**
 * Quick clip actions in the preview's control strip, with one-key shortcuts: play just this clip (Shift+Space), lock or unlock the frame (U), animate
 * (M), and for pictures Edit with AI (E), Remove (R), Pop-out (P) and Bring to life (B). Shown while a clip is
 * selected; the picture-only ones stay in place, greyed, for a video, so the bar never shifts.
 */
import { useContext, useEffect } from 'react';
import { Clapperboard, Eraser, Layers3, Lock, Move, PlaySquare, Sparkles, Unlock } from 'lucide-react';
import { clipLength, findClip, mainLayer, updateClip, type Clip } from '../../timeline/model';
import type { PlaybackSource } from '../playback';
import { EditorContext } from '../state/EditorContext';
import { openPanelTab } from '../layout';
import { openAiEdit } from '../AiEditDialog';
import { openBringToLife } from '../BringToLifeDialog';
import { openPopout, openRemovePerson } from '../RemovePersonDialog';
import { isTyping } from '../editor-constants';
import { t } from '../../i18n';

const keyName = (key: string) => (key === ' ' ? '⇧Space' : key.toUpperCase());
type Action = { key: string; label: string; icon: React.ReactNode; enabled: boolean; why?: string; run: () => void };

export function ClipQuickBar({ sourceFor, playRange }: { sourceFor: (id: number, clip?: Clip) => PlaybackSource | undefined; playRange: (start: number, end: number) => void }) {
  const store = useContext(EditorContext);
  const timeline = store?.timeline;
  const clip = timeline && store.selectedId ? findClip(timeline, store.selectedId) : null;
  const picture = clip ? sourceFor(clip.media_id, clip)?.kind === 'image' : false;
  const onMain = Boolean(clip && timeline && mainLayer(timeline).items.some((item) => item.id === clip.id));
  const actions: Action[] = !clip || !timeline || !store ? [] : [
    // Shift+Space: from the clip's first frame to its last, then stop, to see its own moves and effects.
    { key: ' ', label: 'Play this clip', icon: <PlaySquare size={14}/>, enabled: true, run: () => playRange(clip.start, clip.start + clipLength(clip)) },
    { key: 'u', label: clip.frame_locked ? 'Unlock frame' : 'Lock frame', icon: clip.frame_locked ? <Lock size={14}/> : <Unlock size={14}/>, enabled: true,
      run: () => store.change(updateClip(timeline, clip.id, { frame_locked: !clip.frame_locked })) },
    { key: 'm', label: 'Animate', icon: <Move size={14}/>, enabled: true,
      run: () => { if (clip.frame_locked) store.change(updateClip(timeline, clip.id, { frame_locked: false })); openPanelTab('clip', 'motion'); } },
    { key: 'e', label: 'Edit with AI', icon: <Sparkles size={14}/>, enabled: picture, why: 'For pictures', run: () => openAiEdit({ clipId: clip.id, mediaId: clip.media_id }) },
    { key: 'r', label: 'Remove person or object', icon: <Eraser size={14}/>, enabled: picture, why: 'For pictures', run: () => openRemovePerson({ clipId: clip.id, mediaId: clip.media_id }) },
    { key: 'p', label: 'Pop-out (3D)', icon: <Layers3 size={14}/>, enabled: picture && onMain, why: picture ? 'For pictures on the main track' : 'For pictures', run: () => openPopout({ clipId: clip.id, mediaId: clip.media_id }) },
    { key: 'b', label: 'Bring to life', icon: <Clapperboard size={14}/>, enabled: picture, why: 'For pictures', run: () => openBringToLife({ clipId: clip.id, mediaId: clip.media_id }) },
  ];
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || document.querySelector('.ed-modal')) return;
      // Space alone plays from the playhead (the editor's own shortcut); Shift+Space plays just this clip.
      const action = event.key === ' ' ? (event.shiftKey ? actions[0] : undefined) : event.shiftKey ? undefined : actions.find((each) => each.key === event.key.toLowerCase());
      if (action?.enabled) { event.preventDefault(); event.stopPropagation(); action.run(); }
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  });
  if (!actions.length) return null;
  return <span className="ed-quickbar" role="toolbar" aria-label={t('Clip actions')}>
    {actions.map((action) => <button key={action.key} className="ed-icon" disabled={!action.enabled} aria-label={`${t(action.label)} (${keyName(action.key)})`}
      data-tip={action.enabled ? `${t(action.label)} · ${keyName(action.key)}` : `${t(action.label)} · ${t(action.why ?? '')}`} onClick={action.run}>{action.icon}</button>)}
  </span>;
}
