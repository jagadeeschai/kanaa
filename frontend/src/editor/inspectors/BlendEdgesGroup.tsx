import { useState } from 'react';
import { t } from '../../i18n';
import { colourMatch } from '../../api/client';
import { clipLength, type Clip, type Composite } from '../../timeline/model';
import { DEFAULT_COMPOSITE } from '../../timeline/composite';
import { useEditor } from '../state/EditorContext';
import { ValueSlider } from '../controls';
import { Group } from '../layout';

/** For a green-screen or cut-out clip: tighten its edge, let the background's light wrap it, and match its colour. */
export function BlendEdgesGroup({ clip, onChange }: { clip: Clip; onChange: (changes: Partial<Clip>, group?: string) => void }) {
  const { timeline, now } = useEditor();
  const [busy, setBusy] = useState(false), [note, setNote] = useState('');
  if (!clip.chroma && clip.cutout !== 'remove') return null;
  const composite: Composite = clip.composite ?? { choke: 0, wrap: 0, match: 0, match_gain: null };
  const set = (changes: Partial<Composite>, group?: string) => onChange({ composite: { ...composite, ...changes } }, group);
  const match = async () => {
    setBusy(true); setNote('');
    const inside = now >= clip.start && now < clip.start + clipLength(clip) ? now : clip.start + clipLength(clip) / 2;
    try { const { gain } = await colourMatch(timeline, clip.id, inside); set({ match_gain: gain, match: composite.match || .7 }); }
    catch (error) { setNote(error instanceof Error ? error.message : t('Could not measure the colours.')); }
    finally { setBusy(false); }
  };
  return <Group title="Blend with background" tab="background" startOpen changed={Boolean(composite.choke || composite.wrap || composite.match)} keywords="edge fringe halo light wrap colour match virtual background composite" tip="Makes the person look like they are really there: a clean edge, the background's light on it, and the same colours.">
    {!clip.composite && <button className="ed-button wide" onClick={() => onChange({ composite: DEFAULT_COMPOSITE })}>{t('Blend in one click')}</button>}
    <ValueSlider label="Tighten edge" value={composite.choke} min={0} max={.9} step={.01} defaultValue={DEFAULT_COMPOSITE.choke} unit="%" factor={100} onChange={(choke, group) => set({ choke }, group)}/>
    <ValueSlider label="Light wrap" value={composite.wrap} min={0} max={1} step={.01} defaultValue={DEFAULT_COMPOSITE.wrap} unit="%" factor={100} onChange={(wrap, group) => set({ wrap }, group)}/>
    <button className="ed-button wide" disabled={busy} onClick={() => { void match(); }}>{busy ? t('Measuring colours…') : composite.match_gain ? t('Match colour again here') : t('Match the background colour')}</button>
    {composite.match_gain && <ValueSlider label="Colour match" value={composite.match} min={0} max={1} step={.01} defaultValue={.7} unit="%" factor={100} onChange={(value, group) => set({ match: value }, group)}/>}
    {note && <p className="ed-error">{note}</p>}
  </Group>;
}
