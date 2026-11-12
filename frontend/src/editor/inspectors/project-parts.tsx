/** Pieces shared by the settings panels (moved from Editor.tsx unchanged). */
import KanaaSelect from '../../components/KanaaSelect';
import { type Photo } from '../../types/photo';
import { Group } from '../layout';
import { useState } from 'react';

/** Settings for the whole film: its shape and frame rate, its look, and its sound. Shown when nothing is selected. */
export const FRAME_RATES = [24, 25, 30, 50, 60] as const;

export const RATE_TIPS: Record<number, string> = { 24: 'the film look', 25: 'TV in India and Europe', 30: 'most phones; a safe choice', 50: 'smooth motion, PAL', 60: 'smoothest; sport and action' };

/** The animated brand intro: a leaf falls among music notes and becomes the logo, with Tamil and English lines beneath. */
export function BrandIntroGroup({ logos, logo, busy, has, onMake }: { logos: Photo[]; logo: Photo | null; busy: number | null; has: boolean; onMake: (logo: Photo, tamil: string, english: string) => void }) {
  const [chosen, setChosen] = useState<number | null>(logo?.id ?? null);
  const [tamil, setTamil] = useState('வழங்கும்');
  const [english, setEnglish] = useState('PRESENTS');
  const picked = logos.find((item) => item.id === (chosen ?? logo?.id)) ?? null;
  return <Group title="Brand intro" tab="brand" startOpen={has} changed={has} keywords="brand intro logo animation opening presents vazhangum leaf notes channel" tip="Your logo comes to life at the start: a leaf falls among music notes and becomes it, with வழங்கும் and PRESENTS beneath." help="brand-watermark">
    <label className="ed-lut-field"><span>Logo</span><KanaaSelect aria-label="Logo for the brand intro" value={picked ? String(picked.id) : ''} onChange={(event) => setChosen(Number(event.target.value) || null)}>
      <option value="">Choose a logo…</option>{logos.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
    </KanaaSelect></label>
    <label className="ed-lut-field"><span>Tamil line</span><input className="ed-text" lang="ta" value={tamil} maxLength={40} onChange={(event) => setTamil(event.target.value)} aria-label="Tamil line under the logo"/></label>
    <label className="ed-lut-field"><span>English line</span><input className="ed-text" value={english} maxLength={40} onChange={(event) => setEnglish(event.target.value)} aria-label="English line under the logo"/></label>
    <button className="ed-button wide primary" disabled={!picked || busy !== null} onClick={() => picked && onMake(picked, tamil.trim(), english.trim())}>{busy !== null ? `Making the intro… ${busy}%` : has ? 'Replace the brand intro' : 'Add brand intro at the start'}</button>
    <p className="ed-group-tip">A logo with a transparent background (PNG) works best: its largest shape falls as the leaf, and anything cut out of it appears when it strikes the notes. 5.5 seconds, made once.</p>
  </Group>;
}

