import { clipLength, fillScale, mainLayer, newClip, type Clip, type SourceFacts, type Timeline } from './model.ts';

/**
 * A story template lays out a whole video: labelled moments in order, each with a length, and the theme that dresses
 * it. The person puts a clip or photo in each moment; anything left empty is skipped. A video longer than its moment
 * keeps its middle, where the action usually is; a shorter one plays in full. Every clip fills the frame, as in a reel.
 */
export type Slot = { label: string; tamil: string; seconds: number; hint: string };
export type Story = { id: string; label: string; tamil: string; about: string; theme: string; slots: Slot[] };

const slot = (label: string, tamil: string, seconds: number, hint: string): Slot => ({ label, tamil, seconds, hint });

export const STORIES: Story[] = [
  { id: 'wedding', label: 'Wedding highlights', tamil: 'திருமணச் சிறப்பு', about: 'From the arrival to the send-off', theme: 'wedding', slots: [
    slot('Arrival', 'வருகை', 4, 'Guests arriving, the venue, the decorations'), slot('Getting ready', 'அலங்காரம்', 4, 'Make-up, dressing, jewellery'),
    slot('The ceremony', 'முகூர்த்தம்', 6, 'The thali, the vows, the key moment'), slot('Family', 'குடும்பம்', 4, 'Parents, grandparents, blessings'),
    slot('Celebration', 'கொண்டாட்டம்', 5, 'Dancing, laughter, the feast'), slot('Send-off', 'வழியனுப்பு', 4, 'The couple leaving, a last look') ] },
  { id: 'trip', label: 'Trip recap', tamil: 'பயண நினைவுகள்', about: 'A journey in six moments', theme: 'travel', slots: [
    slot('Setting off', 'புறப்பாடு', 3, 'Packing, the car, the station'), slot('On the road', 'வழியில்', 4, 'Views from the window'),
    slot('First view', 'முதல் பார்வை', 5, 'The place you came to see'), slot('Food', 'உணவு', 4, 'Something you ate'),
    slot('Best moment', 'சிறந்த தருணம்', 5, 'The one you will remember'), slot('Heading home', 'திரும்புதல்', 4, 'Sunset, the way back') ] },
  { id: 'birthday', label: 'Birthday reel', tamil: 'பிறந்தநாள் ரீல்', about: 'Short, bright and fun', theme: 'birthday', slots: [
    slot('The star', 'நாயகன் / நாயகி', 4, 'The birthday person, close up'), slot('Decorations', 'அலங்காரம்', 3, 'Balloons, banner, the room'),
    slot('The cake', 'கேக்', 5, 'Candles and cutting the cake'), slot('Wishes', 'வாழ்த்துகள்', 4, 'Friends and family wishing'),
    slot('Party', 'கொண்டாட்டம்', 5, 'Games, dancing, everyone together'), slot('Gifts', 'பரிசுகள்', 4, 'Opening presents') ] },
  { id: 'festival', label: 'Festival day', tamil: 'பண்டிகை நாள்', about: 'Pongal, Deepavali or any festival', theme: 'festival', slots: [
    slot('Morning', 'காலை', 4, 'Waking up, the oil bath, new clothes'), slot('Kolam', 'கோலம்', 4, 'The kolam at the door'),
    slot('Pooja', 'பூஜை', 5, 'Lamps, flowers, the prayer'), slot('Feast', 'விருந்து', 4, 'Pongal, sweets, the meal on a leaf'),
    slot('Family', 'குடும்பம்', 4, 'Everyone together'), slot('Celebration', 'கொண்டாட்டம்', 5, 'Crackers, games, the evening') ] },
  { id: 'temple', label: 'Temple visit', tamil: 'கோவில் பயணம்', about: 'Calm, with gentle fades', theme: 'memories', slots: [
    slot('Arrival', 'வருகை', 4, 'The approach, the crowd, the shops'), slot('Gopuram', 'கோபுரம்', 5, 'Looking up at the tower'),
    slot('Inside', 'உள்ளே', 5, 'Pillars, corridors, lamps'), slot('Prasadam', 'பிரசாதம்', 4, 'Offerings and prasadam'),
    slot('Together', 'ஒன்றாக', 4, 'The family at the temple') ] },
  { id: 'product', label: 'Product intro', tamil: 'பொருள் அறிமுகம்', about: 'For a shop or a small business', theme: 'vlog', slots: [
    slot('The hook', 'ஈர்ப்பு', 3, 'One striking shot to stop the scroll'), slot('The problem', 'சிக்கல்', 4, 'What people struggle with'),
    slot('Meet it', 'அறிமுகம்', 5, 'The product, clearly shown'), slot('How it works', 'பயன்பாடு', 6, 'Using it, step by step'),
    slot('Why people love it', 'சிறப்பு', 5, 'Happy customers, the result'), slot('Get yours', 'வாங்குங்கள்', 3, 'Where to buy, your shop or number') ] },
  { id: 'memories', label: 'Then and now', tamil: 'அன்றும் இன்றும்', about: 'Old photos to today', theme: 'memories', slots: [
    slot('Long ago', 'அன்று', 5, 'The oldest photo you have'), slot('Growing up', 'வளர்ந்தபோது', 5, 'School days, young years'),
    slot('Together', 'ஒன்றாக', 5, 'Family and friends'), slot('Big moments', 'முக்கிய தருணங்கள்', 5, 'Milestones'),
    slot('Today', 'இன்று', 5, 'Where things are now') ] },
];

/** Total length when every moment is filled. */
export const storySeconds = (story: Story) => story.slots.reduce((sum, item) => sum + item.seconds, 0);

/** The clip for one moment: a video's best stretch of the moment's length (`best`, from the backend), else its middle, or a photo for that long. */
export function slotClip(item: Slot, source: SourceFacts, id: string, best?: number | null): Clip {
  const clip = newClip(source, id);
  if (source.media_type === 'image') return { ...clip, out: item.seconds };
  const available = source.duration ?? item.seconds;
  if (available <= item.seconds) return { ...clip, in: 0, out: round(available) };
  const start = round(best != null ? Math.min(Math.max(0, best), available - item.seconds) : (available - item.seconds) / 2);
  return { ...clip, in: start, out: round(start + item.seconds) };
}

/**
 * The story's clips on the main track, in its order, in place of whatever was there. Other layers stay. Empty moments
 * are skipped. `fills[i]` is what goes in the story's moment i.
 */
export function buildStory(timeline: Timeline, story: Story, fills: (SourceFacts | null)[], newId: () => string, best: (number | null)[] = []): Timeline {
  const main = mainLayer(timeline);
  let cursor = 0;
  const clips: Clip[] = [];
  story.slots.forEach((item, index) => {
    const source = fills[index];
    if (!source) return;
    const fitted = slotClip(item, source, newId(), best[index]);
    const scale = source.width && source.height ? round(fillScale({ width: source.width, height: source.height }, 0, timeline.format)) : 1;
    const clip = { ...fitted, start: round(cursor), transform: { ...fitted.transform, scale } };
    cursor += clipLength(clip);
    clips.push(clip);
  });
  return { ...timeline, layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: clips } : layer)) };
}

/** Puts unused media into the empty moments, in the order the media is listed. */
export function fillRest(story: Story, fills: (SourceFacts | null)[], media: SourceFacts[]): (SourceFacts | null)[] {
  const used = new Set(fills.filter(Boolean).map((source) => source!.media_id));
  const spare = media.filter((source) => !used.has(source.media_id));
  return story.slots.map((_, index) => fills[index] ?? spare.shift() ?? null);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
