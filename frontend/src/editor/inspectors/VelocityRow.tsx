/** Velocity on the beat: the speed ramp built from the song's beats (timeline/velocity.ts), for one clip or all of them. */
import { useState } from 'react';
import { t } from '../../i18n';
import { updateClip, type Clip } from '../../timeline/model';
import { velocityEvery, velocityRamp, VELOCITY_CHOICES, type VelocityName } from '../../timeline/velocity';
import { useSongBeats } from '../hooks/useSongBeats';
import { useEditor } from '../state/EditorContext';

export function VelocityRow({ clip, onChange }: { clip: Clip; onChange: (changes: Partial<Clip>) => void }) {
  const { timeline, change } = useEditor();
  const { song, beats } = useSongBeats(timeline!);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<VelocityName>('punchy');
  const current = VELOCITY_CHOICES.find((choice) => JSON.stringify(velocityRamp(clip, beats ?? [], choice.id)) === JSON.stringify(clip.ramp))?.id ?? null;
  if (!song) return null;
  const pick = (id: VelocityName) => {
    setPicked(id);
    const ramp = velocityRamp(clip, beats ?? [], id);
    if (!ramp) { setNote(t('Fewer than two beats of the song fall in this clip.')); return; }
    setNote(null);
    onChange({ ramp });
  };
  const every = () => {
    let next = timeline!;
    const plan = velocityEvery(next, beats ?? [], current ?? picked);
    for (const { id, ramp } of plan) next = updateClip(next, id, { ramp });
    if (plan.length) change(next, `velocity-every-${Date.now()}`);
  };
  return <>
    <h3 className="ed-sub">{t('Velocity on the beat')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Velocity on the beat')}>
      {VELOCITY_CHOICES.map((choice) => <button key={choice.id} className={current === choice.id ? 'on' : ''} aria-pressed={current === choice.id} title={t(choice.about)}
        disabled={!beats?.length} onClick={() => pick(choice.id)}>{t(choice.label)}</button>)}
    </div>
    {note && <p className="ed-tip" role="status">{note}</p>}
    <button className="ed-button wide" disabled={!beats?.length} onClick={every}>{t('Use on every clip')}</button>
  </>;
}
