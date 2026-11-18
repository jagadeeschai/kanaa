/**
 * Effect look: the colour, size and strength of an overlay effect (a light leak, flare, bokeh, sparkles...) in plain
 * choices. The colour is the effect's own light turned mostly grey and tinted with the colour wheels; the strength is
 * its brightness (on a screen-blended layer, brighter light shows more); the size is its scale. All are ordinary clip
 * settings, so the preview, the export and the GPU draw them alike.
 */
import { FLAT_WHEEL, type ColourWheels } from './colourWheels.ts';
import { DEFAULT_ADJUST, type Clip } from './model.ts';

export type EffectColour = 'original' | 'gold' | 'pink' | 'red' | 'purple' | 'blue' | 'teal' | 'green' | 'white';
export const EFFECT_COLOURS: { id: EffectColour; label: string; swatch: string; hue: number | null }[] = [
  { id: 'original', label: 'Original', swatch: 'linear-gradient(135deg,#ff9a4d,#ffd27a)', hue: null },
  { id: 'gold', label: 'Gold', swatch: '#f4c04e', hue: 45 }, { id: 'pink', label: 'Pink', swatch: '#f472b6', hue: 330 },
  { id: 'red', label: 'Red', swatch: '#ef4444', hue: 0 }, { id: 'purple', label: 'Purple', swatch: '#a855f7', hue: 275 },
  { id: 'blue', label: 'Blue', swatch: '#3b82f6', hue: 218 }, { id: 'teal', label: 'Teal', swatch: '#14b8a6', hue: 175 },
  { id: 'green', label: 'Green', swatch: '#22c55e', hue: 125 }, { id: 'white', label: 'White', swatch: '#f8fafc', hue: null },
];
const TINT = 1, GREY = 0.1;  // How strongly the colour is pushed; how much of the effect's own colour is kept.

/** The settings for `colour`, replacing any earlier effect colour. */
export function colourChanges(clip: Clip, colour: EffectColour): Partial<Clip> {
  const choice = EFFECT_COLOURS.find((each) => each.id === colour)!;
  const adjust = { ...DEFAULT_ADJUST, ...clip.adjust };
  if (colour === 'original') return { adjust: { ...adjust, saturation: 1 }, wheels: null };
  if (choice.hue === null) return { adjust: { ...adjust, saturation: 0 }, wheels: null };
  const wheel = { hue: choice.hue, amount: TINT, brightness: 0 };
  const wheels: ColourWheels = { shadows: FLAT_WHEEL, midtones: wheel, highlights: { ...wheel, amount: TINT * 0.85 } };
  return { adjust: { ...adjust, saturation: GREY }, wheels };
}

/** Which colour a clip has now, if it is one of ours. */
export function currentColour(clip: Clip): EffectColour | null {
  const wheels = clip.wheels;
  const saturation = clip.adjust?.saturation ?? 1;
  if (!wheels && saturation === 1) return 'original';
  if (!wheels && saturation === 0) return 'white';
  const hue = wheels?.midtones.hue;
  return EFFECT_COLOURS.find((each) => each.hue !== null && each.hue === hue && Math.abs(saturation - GREY) < 1e-6)?.id ?? null;
}

export const EFFECT_SIZES: { id: string; label: string; scale: number }[] = [{ id: 'small', label: 'Small', scale: 0.7 }, { id: 'normal', label: 'Normal', scale: 1 }, { id: 'large', label: 'Large', scale: 1.4 }];
