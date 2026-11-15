import { TextTabSection1 } from './tabs/TextTab';
import { EffectsTabSection1, EffectsTabSection2, EffectsTabSection3, EffectsTabSection4, EffectsTabSection5 } from './tabs/EffectsTab';
import { ThemesTabSection1 } from './tabs/ThemesTab';
import { TemplatesTabSection1 } from './tabs/TemplatesTab';
import { MediaTabSection1, MediaTabSection2 } from './tabs/MediaTab';
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
        {leftTab === 'words' && <div data-keep-panel><WordsPanel tokens={tokens} clips={mainClips} language={language} onLanguage={(next) => { setLanguage(next); setWordSelection(new Set()); try { localStorage.setItem('wa.wordsLanguage', next); } catch { /* It just won't be remembered. */ } }} missing={missingWords.length} locked={Boolean(timeline && mainLayer(timeline).locked)}
          busy={wordJob ? `Listening to your video… ${wordJob.progress}%` : null} hasTracks={Boolean(timeline && timeline.layers.length > 1)} onTranscribe={() => { void transcribeClips(); }} onCancel={() => { if (wordJob) void cancelRenderJob(wordJob.id); }} onSeek={seek} onCut={cutWords} playhead={playhead} selection={wordSelection} onSelection={setWordSelection} tidy={tidy} pauseLength={pauseLength} onPauseLength={setPauseLength} fillers={removeFillers} onFillers={setRemoveFillers} onTidy={removePauses}
          onMenu={(event, keys) => setMenu({ x: event.clientX, y: event.clientY, items: [{ label: keys.size === 1 ? 'Cut' : `Cut ${keys.size} items`, hint: '⌫', danger: true, onSelect: () => cutWords(keys) }] })}/></div>}
        <TemplatesTabSection1/>
        <ThemesTabSection1/>
        {leftTab === 'transitions' && <>
          <p className="ed-tip">Drag onto a clip, or click to apply to the selected clip.</p>
          <div className="ed-quick" role="group" aria-label="Transitions">{TRANSITIONS.map((item) => <button key={item.id} className={`ed-quick-tile transition ${transitionPick === item.id ? 'on' : ''}`} {...draggableAs({ kind: 'transition', transition: item.id })} onClick={() => { setTransitionPick(item.id); applyToSelected({ kind: 'transition', transition: item.id }); }} title={`${item.label} into a clip`}>{TRANSITION_ICONS[item.id]}{item.label}</button>)}</div>
          {timeline && mainLayer(timeline).items.length > 1 && !mainLayer(timeline).locked && <>
            <button className="ed-button wide" onClick={() => change(transitionEverywhere(timeline, transitionPick, 0.6), 'transition-all')} title={`Put a ${transitionPick} on every cut`}><Shuffle size={14}/>Every cut: {TRANSITIONS.find((item) => item.id === transitionPick)?.label ?? transitionPick}</button>
            {mainLayer(timeline).items.some((clip) => clip.transition_in) && <button className="ed-button wide" onClick={() => setConfirmingClear(true)}><X size={14}/>Remove all transitions</button>}
          </>}
          <p className="ed-tip">{t('To change one cut’s length or direction, click the cut between two clips on the timeline.')}</p>
        </>}
        {leftTab === 'ask' && timeline && <div data-keep-panel><AskPanel timeline={timeline} options={askOptions} project={askProject} onApply={runAsk}/></div>}
        <EffectsTabSection1/>
        <EffectsTabSection2/>
        <MediaTabSection2/>
        <EffectsTabSection3/>
        <EffectsTabSection4/>
        <EffectsTabSection5/>
        <TextTabSection1/>
        {leftTab === 'audio' && <>
          <section className="ed-add" aria-label="Your music"><h3 className="ed-sub">Your music library</h3>
            {library === null ? <p className="ed-tip">Reading your Music library…</p> : !library.length ? <p className="ed-tip">No music found in {libraryFolder || 'your Music app folder'}.</p> : (() => {
              const query = musicSearch.trim().toLowerCase();
              const visible = library.filter((track) => (!musicMood || track.mood === musicMood) && (!query || track.name.toLowerCase().includes(query) || (track.genre ?? '').toLowerCase().includes(query)));
              return <>
              <div className="ed-effect-search" data-keep-panel><Search size={14}/><input type="search" value={musicSearch} onChange={(event) => setMusicSearch(event.target.value)} placeholder="Search songs or genres…" aria-label="Search music"/>{musicSearch && <button className="ed-icon small" aria-label="Clear music search" onClick={() => setMusicSearch('')}><X size={12}/></button>}</div>
              <div className="ed-chips" role="group" aria-label="Mood" data-keep-panel>{([null, ...MOODS] as (Mood | null)[]).map((mood) => <button key={mood ?? 'all'} className={musicMood === mood ? 'on' : ''} aria-pressed={musicMood === mood} onClick={() => setMusicMood(mood)}>{mood ? MOOD_LABELS[mood] : 'All'}</button>)}</div>
              {visible.length ? <ul className="ed-tracks" data-keep-panel>{visible.map((track) => <li key={track.id} className={listening === track.id ? 'playing' : ''} {...draggableAs({ kind: 'track', track: track.id })} title="Drag onto the timeline to add it there">
                <button className="ed-icon small" aria-label={`${listening === track.id ? 'Stop' : 'Listen to'} ${track.name}`} onClick={() => listen(track.id)}>{listening === track.id ? <Pause size={13}/> : <Play size={13}/>}</button>
                <span><b title={track.name}>{track.name}</b><small>{[track.genre, timecode(track.seconds).replace(/\.\d+$/, '')].filter(Boolean).join(' · ')}</small></span>
                <button className="ed-icon small" aria-label={`Add ${track.name} at the playhead`} title="Add at the playhead" disabled={addingMusic} onClick={() => { void addLibraryTrack(track); }}><Plus size={14}/></button></li>)}</ul>
              : <p className="ed-tip">No tracks match {musicSearch ? `“${musicSearch}”` : 'this filter'}{musicMood ? ` in ${MOOD_LABELS[musicMood]}` : ''}.</p>}
              <p className="ed-tip">+ adds at the playhead, drag goes to the timeline, play previews. From {libraryFolder}; your files are only read.</p>
              </>;
            })()}
          </section>
          <section className="ed-add" aria-label="Your own song"><h3 className="ed-sub">Add your own song</h3><p className="ed-tip">Any audio file, added at the playhead; it dips under speech.</p>
            <label className={`ed-button wide ed-music ${addingMusic ? 'busy' : ''}`}>{addingMusic ? <LoaderCircle className="spin" size={15}/> : <Music size={15}/>}{addingMusic ? 'Adding music…' : 'Choose an audio file'}
              <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" disabled={addingMusic} aria-label="Add music" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addMusic(file); }}/></label>
          </section>
          {!layout.simple && <section className="ed-add" aria-label="Whooshes and hits"><h3 className="ed-sub">Whooshes and hits</h3><p className="ed-tip">A whoosh on each cut and a hit on each title, landed on the moment.</p>
            {(['whoosh', 'hit'] as const).map((kind) => { const choices = (soundEffects ?? []).filter((effect) => effect.kind === kind); const placed = timeline ? timeline.layers.some((layer) => layer.kind === 'audio' && layer.items.some((sound) => sound.name === (kind === 'whoosh' ? 'Whoosh' : 'Hit'))) : false; return <div key={kind} className="ed-sfx">
              <label className="ed-field">{kind === 'whoosh' ? 'Whoosh' : 'Hit'}<select value={sfxChoice[kind]} onChange={(event) => setSfxChoice({ ...sfxChoice, [kind]: event.target.value })}>{choices.length ? choices.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}{effect.own ? '' : ' · your library'}</option>) : <option value={`kanaa-${kind}`}>{kind === 'whoosh' ? "Kanaa's whoosh" : "Kanaa's hit"}</option>}</select></label>
              <div className="ed-pair-small"><button className="ed-button" disabled={!total || sfxBusy !== null} onClick={() => { void addSoundEffects(kind); }}>{sfxBusy === kind ? <LoaderCircle className="spin" size={13}/> : <AudioLines size={13}/>}{kind === 'whoosh' ? 'On transitions' : 'On titles'}</button>
                {placed && <button className="ed-icon small" aria-label={`Remove the ${kind === 'whoosh' ? 'whooshes' : 'hits'}`} title="Remove them" onClick={() => { if (timeline) change(removeEffects(timeline, kind)); }}><X size={13}/></button>}</div></div>; })}
            {sfxNote && <p className="ed-tip" role="status">{sfxNote}</p>}
            {soundEffects && soundEffects.every((effect) => effect.own) && <p className="ed-tip">Whooshes and hits in your music library (by name, under 30 seconds) show here too.</p>}</section>}
          {!layout.simple && <section className="ed-add" aria-label="Cut to the beat"><h3 className="ed-sub">Cut to the beat</h3><p className="ed-tip">Each clip on the main track ends on the song's nearest beat, so cuts land with the music.</p>
            <button className="ed-button wide" disabled={!total || beatBusy || Boolean(timeline && mainLayer(timeline).locked)} onClick={() => { void cutClipsToBeat(); }}>{beatBusy ? <LoaderCircle className="spin" size={14}/> : <AudioLines size={14}/>}{beatBusy ? 'Listening for the beat…' : 'Cut clips to the beat'}</button>
            {beatNote && <p className="ed-tip" role="status">{beatNote}</p>}</section>}
        </>}
        </div>}
      </aside>);
}
