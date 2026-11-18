import { AskTabSection1 } from './tabs/AskTab';
import { TransitionsTabSection1 } from './tabs/TransitionsTab';
import { WordsTabSection1 } from './tabs/WordsTab';
import { AudioTabSection1 } from './tabs/AudioTab';
import { TextTabSection1 } from './tabs/TextTab';
import { EffectsTabParts } from './tabs/EffectsTab';
import { ThemesTabSection1 } from './tabs/ThemesTab';
import { TemplatesTabSection1 } from './tabs/TemplatesTab';
import { MediaTabSection1 } from './tabs/MediaTab';
import { useEditorPanel } from '../state/EditorContext';
import type { ActiveEffect } from '../../timeline/effects';
import type { Layout } from '../layout';
import type { Tidy, Token } from '../../timeline/words';
import type { CLIP_EFFECT_PRESETS } from '../editor-constants';
import { ArrowLeft,AudioLines,Captions,Check,EyeOff,Layers,LoaderCircle,Minus,Music,Pause,Play,Plus,ScanFace,Search,Shuffle,Sparkles,Type,WandSparkles,X } from "lucide-react";
import { Fragment } from "react";
import { cancelRenderJob,getPhoto,photoThumbUrl,type EffectInfo,type LibraryTrack,type Mood,type SoundEffectInfo } from "../../api/client";
import ImportArea from "../../components/ImportArea";
import KanaaSelect from "../../components/KanaaSelect";
import { t } from "../../i18n";
import type { TransitionKind } from "../../timeline/animation";
import { type Options,type Proposed } from "../../timeline/commands";
import { dropClip,type DragPayload } from "../../timeline/drop";
import { captionLayers,mainLayer,newClip,timecode,type BlurBox,type Clip,type SourceFacts,type Timeline } from "../../timeline/model";
import { removeEffects } from "../../timeline/sfx";
import { fillRest,STORIES,storySeconds,type Story } from "../../timeline/stories";
import { TEMPLATES,type Template } from "../../timeline/templates";
import { activeTheme,removeTheme,themeMusic,THEMES,type Theme as VideoTheme } from "../../timeline/themes";
import { transitionEverywhere } from "../../timeline/transitions";
import type { Photo } from "../../types/photo";
import AskPanel from "../AskPanel";
import { type MenuState } from "../ContextMenu";
import { ValueSlider } from "../controls";
import { Chips } from "../inspectors/parts";
import { PlaybackEngine } from "../playback";
import { type SaveState } from "../project-save";
import { TRANSITION_ICONS,TRANSITIONS } from "../transition-catalog";
import TravelMapPanel from "../TravelMapPanel";
import { LANGUAGES,WordsPanel } from "../Words";

export type EditorLeftRailBindings = {
  activeClipEffects: ActiveEffect[];
  addBlurBox: (style: BlurBox["style"], at?: [number, number]) => void;
  addEffect: (effectId: string, dropAt?: number, length?: number, around?: Partial<Clip["transform"]>) => Promise<void>;
  addingMusic: boolean;
  addLibraryTrack: (track: LibraryTrack, dropAt?: number) => Promise<void>;
  addMedia: (item: Photo) => void;
  addMusic: (file: File) => Promise<void>;
  addOverlayMedia: (item: Photo, dropAt?: number) => void;
  addSoundEffects: (kind: "whoosh" | "hit") => Promise<void>;
  addThunder: () => Promise<void>;
  addTitle: (title: Template, dropAt?: number, words?: string) => Promise<void>;
  applyClipEffect: (id: (typeof CLIP_EFFECT_PRESETS)[number]["id"]) => Promise<void>;
  applyToSelected: (payload: DragPayload) => void;
  askOptions: Options;
  askProject: () => { format?: undefined; duration?: undefined; clip_count?: undefined; clips?: undefined; theme?: undefined; music?: undefined; titles?: undefined; captions?: undefined; media?: undefined; } | { format: string; duration: number; clip_count: number; clips: { kind: string; name: string; length: number; start: number; }[]; theme: string; music: string[]; titles: string[]; captions: string[]; media: string[]; };
  beatBusy: boolean;
  beatNote: string | null;
  blurFaces: () => Promise<void>;
  captionsWaiting: boolean;
  captionWords: number;
  change: (next: Timeline, group?: string | null) => void;
  changeThemeMusic: (on: boolean) => Promise<void>;
  chooseTheme: (look: VideoTheme, base?: Timeline | null, busy?: string) => Promise<void>;
  clearing: boolean;
  clearNote: string | null;
  clipEffectApplied: (id: (typeof CLIP_EFFECT_PRESETS)[number]["id"]) => boolean;
  closeEditor: () => Promise<void>;
  cutClipsToBeat: () => Promise<void>;
  cutWords: (keys: Set<string>) => void;
  draggableAs: (payload: DragPayload) => { draggable: boolean; onDragStart: (event: React.DragEvent) => void; onDragEnd: () => void; };
  effectBusy: { id: string; progress: number; } | null;
  effectNeedle: string;
  effects: EffectInfo[];
  effectSearch: string;
  effectSection: string | null;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  faceJob: { jobId: string; clipId: string; progress: number; } | null;
  faceNote: string;
  facts: (id: number) => SourceFacts | undefined;
  folder: string | null;
  folders: string[];
  forgetStyle: (id: string) => void;
  inVideo: Photo[];
  keepClearOfFaces: () => Promise<void>;
  language: string;
  layout: Layout;
  LEFT_TAB_LABELS: Record<"media" | "audio" | "text" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask", string>;
  LEFT_TABS: readonly ["media", "audio", "text", "words", "transitions", "effects", "templates", "themes", "ask"];
  leftTab: "media" | "audio" | "text" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask";
  library: LibraryTrack[] | null;
  libraryFolder: string;
  listen: (id: string) => void;
  listening: string | null;
  LITE_TABS: Set<string>;
  mainClips: Clip[];
  makeCaptions: (words?: number) => void;
  makeStory: () => Promise<void>;
  matchingClipEffects: ({ readonly id: "colour-splash"; readonly group: "Stylise"; readonly label: "Colour splash"; readonly about: "Keep one chosen colour while everything else turns monochrome."; } | { readonly id: "dreamy-glow"; readonly group: "Stylise"; readonly label: "Dreamy glow"; readonly about: "Soft, warm highlight bloom for weddings and portraits."; } | { readonly id: "split-tone"; readonly group: "Stylise"; readonly label: "Split-tone"; readonly about: "Tint shadows and highlights with two colours, keeping the real colours."; } | { readonly id: "duotone"; readonly group: "Stylise"; readonly label: "Duotone"; readonly about: "Paint the picture in two colours, dark to light."; } | { readonly id: "zoom-blur"; readonly group: "Motion"; readonly label: "Zoom blur"; readonly about: "Streaks rushing towards a centre, like a fast push in."; } | { readonly id: "echo"; readonly group: "Motion"; readonly label: "Echo trail"; readonly about: "Ghosts of the last moments trailing movement, for dance and action."; } | { readonly id: "tilt-shift"; readonly group: "Lens"; readonly label: "Tilt-shift"; readonly about: "A sharp band with soft blur above and below: a toy-town miniature."; } | { readonly id: "mirror"; readonly group: "Shape"; readonly label: "Mirror"; readonly about: "Reflect the left or top half, or all four quarters."; } | { readonly id: "kaleidoscope"; readonly group: "Shape"; readonly label: "Kaleidoscope"; readonly about: "Mirrored wedges turning round the centre."; } | { readonly id: "beat-pulse"; readonly group: "Motion"; readonly label: "Beat pulse"; readonly about: "A quick camera push synchronized to the music."; } | { readonly id: "old-film"; readonly group: "Film"; readonly label: "Old film"; readonly about: "Warm faded stock, grain, scratches and gate weave."; } | { readonly id: "glitch"; readonly group: "Signal"; readonly label: "Digital glitch"; readonly about: "RGB separation, broken bands and digital noise."; } | { readonly id: "vhs"; readonly group: "Signal"; readonly label: "VHS tape"; readonly about: "Tape jitter, scanlines, softness and analogue noise."; } | { readonly id: "raindrops"; readonly group: "Lens"; readonly label: "Raindrops"; readonly about: "Water drops that bend and highlight the picture."; } | { readonly id: "lens-dirt"; readonly group: "Lens"; readonly label: "Lens dirt"; readonly about: "Soft optical dirt and dark lens contamination."; })[];
  matchingOverlayEffects: EffectInfo[];
  media: Photo[];
  mediaById: Map<number, Photo>;
  missingWords: number[];
  momentProgress: number | null;
  MOOD_LABELS: Record<Mood, string>;
  MOODS: Mood[];
  musicMood: Mood | null;
  musicSearch: string;
  myStyles: Template[];
  newId: () => string;
  openMediaMenu: (event: React.MouseEvent, item: Photo) => void;
  otherMedia: Photo[];
  panelOpen: boolean;
  pauseLength: number;
  playhead: { current: number; };
  projectName: string;
  RAIL_BREAK_BEFORE: Set<string>;
  removeFillers: boolean;
  removePauses: () => void;
  runAsk: (commands: Proposed[]) => Promise<string[]>;
  saved: SaveState;
  seek: (t: number) => void | undefined;
  selected: Clip | null;
  setCaptionWords: React.Dispatch<React.SetStateAction<number>>;
  setConfirmingClear: React.Dispatch<React.SetStateAction<boolean>>;
  setCreatingAIImage: React.Dispatch<React.SetStateAction<boolean>>;
  setEffectSearch: React.Dispatch<React.SetStateAction<string>>;
  setEffectSection: React.Dispatch<React.SetStateAction<string | null>>;
  setFaceJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setFolder: React.Dispatch<React.SetStateAction<string | null>>;
  setLanguage: React.Dispatch<React.SetStateAction<string>>;
  setLeftTab: React.Dispatch<React.SetStateAction<"media" | "audio" | "text" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask">>;
  setMedia: React.Dispatch<React.SetStateAction<Photo[]>>;
  setMenu: React.Dispatch<React.SetStateAction<MenuState | null>>;
  setMusicMood: React.Dispatch<React.SetStateAction<Mood | null>>;
  setMusicSearch: React.Dispatch<React.SetStateAction<string>>;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPauseLength: React.Dispatch<React.SetStateAction<number>>;
  setRemoveFillers: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setSfxChoice: React.Dispatch<React.SetStateAction<{ whoosh: string; hit: string; }>>;
  setStory: React.Dispatch<React.SetStateAction<{ story: Story; fills: (number | null)[]; choosing: number | null; } | null>>;
  setThemeWithMusic: React.Dispatch<React.SetStateAction<boolean>>;
  setTransitionPick: React.Dispatch<React.SetStateAction<TransitionKind>>;
  setWeather: React.Dispatch<React.SetStateAction<{ rainDensity: number; rainSpeed: number; rainDirection: "left" | "straight" | "right"; frequency: number; brightness: number; fogDensity: number; fogSpeed: number; fogDirection: "left" | "straight" | "right"; snowDensity: number; snowSpeed: number; snowDirection: "left" | "straight" | "right"; seed: number; }>>;
  setWordSelection: React.Dispatch<React.SetStateAction<Set<string>>>;
  sfxBusy: "whoosh" | "hit" | null;
  sfxChoice: { whoosh: string; hit: string; };
  sfxNote: string | null;
  soundEffects: SoundEffectInfo[] | null;
  story: { story: Story; fills: (number | null)[]; choosing: number | null; } | null;
  storyMedia: Photo[];
  TAB_ICONS: Record<"media" | "audio" | "text" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask", React.ReactNode>;
  TAB_TIPS: Record<"media" | "audio" | "text" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask", string>;
  themeBusy: string | null;
  themeWithMusic: boolean;
  thumbs: Record<string, string>;
  thunderBusy: boolean;
  tidy: Tidy;
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
  tokens: Token[];
  total: number;
  transcribeClips: () => Promise<void>;
  transitionPick: TransitionKind;
  updateLayout: (changes: Partial<Layout>) => void;
  usedIds: Set<number>;
  weather: { rainDensity: number; rainSpeed: number; rainDirection: "left" | "straight" | "right"; frequency: number; brightness: number; fogDensity: number; fogSpeed: number; fogDirection: "left" | "straight" | "right"; snowDensity: number; snowSpeed: number; snowDirection: "left" | "straight" | "right"; seed: number; };
  wordJob: { mediaId: number; id: string; progress: number; left: number[]; } | null;
  wordSelection: Set<string>;
};

export function EditorLeftRail() {
  const { saved, closeEditor, projectName, layout, LEFT_TABS, LITE_TABS, panelOpen, leftTab, RAIL_BREAK_BEFORE, LEFT_TAB_LABELS, TAB_TIPS, setPanelOpen, setLeftTab, TAB_ICONS, updateLayout, timeline, setCreatingAIImage, setMedia, folders, media, folder, setFolder, inVideo, otherMedia, draggableAs, addMedia, openMediaMenu, usedIds, addOverlayMedia, tokens, mainClips, language, setLanguage, setWordSelection, missingWords, wordJob, transcribeClips, seek, cutWords, playhead, wordSelection, tidy, pauseLength, setPauseLength, removeFillers, setRemoveFillers, removePauses, setMenu, story, setStory, mediaById, storyMedia, facts, themeBusy, momentProgress, makeStory, chooseTheme, thumbs, themeWithMusic, setThemeWithMusic, library, changeThemeMusic, change, transitionPick, setTransitionPick, applyToSelected, setConfirmingClear, askOptions, askProject, runAsk, effectSearch, setEffectSearch, selected, activeClipEffects, matchingClipEffects, effectNeedle, effectSection, setEffectSection, clipEffectApplied, applyClipEffect, timelineRef, newId, engineRef, setSelectedId, matchingOverlayEffects, weather, setWeather, effectBusy, total, addEffect, thunderBusy, addThunder, effects, addBlurBox, faceJob, setFaceJob, blurFaces, faceNote, addTitle, myStyles, forgetStyle, captionsWaiting, makeCaptions, captionWords, setCaptionWords, clearing, keepClearOfFaces, clearNote, libraryFolder, musicSearch, musicMood, setMusicSearch, MOODS, setMusicMood, MOOD_LABELS, listening, listen, addingMusic, addLibraryTrack, addMusic, soundEffects, sfxChoice, setSfxChoice, sfxBusy, addSoundEffects, sfxNote, beatBusy, cutClipsToBeat, beatNote } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<aside className="ed-media" aria-label="Add to your video">
        <div className="ed-rail-tabs" role="group" aria-label="Add to your video"><button className={`ed-rail-back ${saved === 'failed' ? 'failed' : ''}`} onClick={() => { void closeEditor(); }} aria-label={t('Back to projects')} data-tip={`${t('Back to projects')} · ${projectName} · ${t(saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved')}`}><ArrowLeft size={17}/></button><span className="ed-rail-divider" role="separator"/>{(layout.simple ? LEFT_TABS.filter((tab) => LITE_TABS.has(tab)) : LEFT_TABS).map((tab, index) => { const on = panelOpen && leftTab === tab; return <Fragment key={tab}>{index > 0 && RAIL_BREAK_BEFORE.has(tab) && <span className="ed-rail-divider" role="separator"/>}<button className={on ? 'on' : ''} aria-pressed={on} aria-label={t(LEFT_TAB_LABELS[tab])} data-tip={t(TAB_TIPS[tab])} onClick={() => { if (panelOpen && leftTab === tab) setPanelOpen(false); else { setLeftTab(tab); setPanelOpen(true); } }}>{TAB_ICONS[tab]}</button></Fragment>; })}{layout.simple && <button className="ed-rail-pro" onClick={() => updateLayout({ simple: false })} aria-label={t('More tools in Pro')} data-tip={t('Switch to Pro for transitions, effects, words and Ask AI')}><Sparkles size={15}/></button>}
</div>
        {panelOpen && <div className="ed-panel-content">
        <MediaTabSection1/>
        <WordsTabSection1/>
        <TemplatesTabSection1/>
        <ThemesTabSection1/>
        <TransitionsTabSection1/>
        <AskTabSection1/>
        <EffectsTabParts/>
        <TextTabSection1/>
        <AudioTabSection1/>
        </div>}
      </aside>);
}
