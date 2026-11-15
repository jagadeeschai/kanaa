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
        {leftTab === 'templates' && timeline && <div data-keep-panel>{(() => {
          if (story) {
            const filled = story.fills.filter((id) => id !== null).length;
            const pick = (index: number, id: number | null) => setStory({ ...story, fills: story.fills.map((current, at) => (at === index ? id : current)), choosing: null });
            return <section className="ed-add" aria-label="Story">
              <div className="ed-add-row"><button className="ed-button" onClick={() => setStory(null)}><ArrowLeft size={13}/>All stories</button><span>{filled} of {story.story.slots.length} filled</span></div>
              <h3 className="ed-sub">{story.story.label} <em lang="ta" className="ed-tamil-note">{story.story.tamil}</em></h3>
              <ol className="ed-slots">{story.story.slots.map((item, index) => { const id = story.fills[index]; const chosen = id !== null ? mediaById.get(id) : undefined; return <li key={item.label} className={story.choosing === index ? 'on' : ''}>
                <button className="ed-slot" onClick={() => setStory({ ...story, choosing: story.choosing === index ? null : index })} title={item.hint}>
                  <span className="ed-slot-art">{chosen ? <img src={photoThumbUrl(chosen.id)} alt=""/> : <Plus size={14}/>}</span>
                  <span className="ed-slot-text"><b>{index + 1}. {item.label}</b><em lang="ta">{item.tamil} · {item.seconds}s</em><small>{chosen ? chosen.filename : item.hint}</small></span></button>
                {chosen && <button className="ed-icon small" aria-label={`Empty ${item.label}`} title="Empty this moment" onClick={() => pick(index, null)}><X size={12}/></button>}
                {story.choosing === index && <div className="ed-media-grid ed-backgrounds">{storyMedia.length ? storyMedia.map((item2) => <button key={item2.id} className="ed-tile-add" onClick={() => pick(index, item2.id)} title={`Use ${item2.filename}`}><img src={photoThumbUrl(item2.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item2.filename}</b></span></button>) : <p className="ed-tip">Import your clips and photos in Media first.</p>}</div>}
              </li>; })}</ol>
              <button className="ed-button wide" disabled={!storyMedia.length || filled === story.fills.length} onClick={() => setStory({ ...story, fills: fillRest(story.story, story.fills.map((id) => (id === null ? null : facts(id) ?? null)), storyMedia.map((item) => facts(item.id)!).filter(Boolean)).map((source) => source?.media_id ?? null), choosing: null })}>Fill the rest with my media</button>
              <button className="ed-primary wide" disabled={!filled || Boolean(themeBusy) || momentProgress !== null} onClick={() => { void makeStory(); }}>{themeBusy || momentProgress !== null ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}{momentProgress !== null ? `Picking the best moments… ${momentProgress}%` : 'Make my video'}</button>
              <p className="ed-tip">Each moment takes the sharpest, steadiest, best-lit part of its clip. {mainLayer(timeline).items.length ? 'This replaces the clips on your main track; undo with ⌘Z.' : ''}</p>
            </section>;
          }
          return <section className="ed-add" aria-label="Story templates">
            <p className="ed-tip">Fill each moment with a clip or photo; Kanaa makes the video, theme and music included.</p>
            <div className="ed-stories">{STORIES.map((item) => <button key={item.id} className="ed-story" onClick={() => setStory({ story: item, fills: item.slots.map(() => null), choosing: null })} title={`${item.slots.map((each) => each.label).join(' → ')}`}>
              <b>{item.label}</b><em lang="ta">{item.tamil}</em><small>{item.slots.length} moments · about {storySeconds(item)}s · {THEMES.find((look) => look.id === item.theme)?.label}</small></button>)}</div>
          </section>;
        })()}</div>}
        {leftTab === 'themes' && timeline && (() => {
          const current = activeTheme(timeline);
          return <section className="ed-add" aria-label="Themes">
            <p className="ed-tip">One click: colours, transitions, photo movement, opening and ending titles. Your clips and words stay.</p>
            <div className="ed-themes">{THEMES.map((look) => <button key={look.id} className={`ed-theme ${current?.id === look.id ? 'on' : ''}`} aria-pressed={current?.id === look.id} onClick={() => { void chooseTheme(look); }} disabled={Boolean(themeBusy)} title={`${look.label}: ${look.about}`}>
              <span className="ed-theme-art" style={{ background: `linear-gradient(135deg, ${look.swatch[0]}, ${look.swatch[1]})` }}>{thumbs[`theme-${look.id}`] && <img src={thumbs[`theme-${look.id}`]} alt=""/>}</span>
              <span className="ed-theme-name"><b>{themeBusy === look.id ? <LoaderCircle className="spin" size={11}/> : null}{look.label}</b><em lang="ta">{look.tamil}</em></span><small>{look.about}</small></button>)}</div>
            <label className="ed-check"><input type="checkbox" checked={themeWithMusic} onChange={(event) => setThemeWithMusic(event.target.checked)}/><span>Add music from your library<small>{library === null ? 'Reading your music…' : library.length ? `${library.length} tracks, matched to each theme's mood.` : 'No music found in your Music app folder.'}</small></span></label>
            {current && (() => { const music = themeMusic(timeline); return <div className="ed-add-row"><span>{music ? <>Music: <b>{music.name.replace(/^Theme music · /, '')}</b></> : 'No music'}</span>
              <span className="ed-pair-small">{library && library.length > 0 && <button className="ed-button" onClick={() => { void changeThemeMusic(true); }}>{music ? 'Another track' : 'Add music'}</button>}{music && <button className="ed-icon small" aria-label="Remove theme music" title="No music" onClick={() => { void changeThemeMusic(false); }}><X size={13}/></button>}</span></div>; })()}
            {current && <button className="ed-button wide" onClick={() => change(removeTheme(timeline))}><X size={14}/>Remove theme</button>}
            <p className="ed-tip">{t('Themes dress the whole video. To colour one clip, select it and open Colour; for a grade over everything, Project settings › Colour & finish.')}</p>
            <p className="ed-tip">Click the opening or ending title on the timeline to edit its words; a new theme keeps them.</p></section>;
        })()}
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
        {leftTab === 'effects' && <div className="ed-effect-search"><Search size={14}/><input type="search" value={effectSearch} onChange={(event) => setEffectSearch(event.target.value)} placeholder="Search effects…" aria-label="Search effects"/>{effectSearch && <button className="ed-icon small" aria-label="Clear effect search" onClick={() => setEffectSearch('')}><X size={12}/></button>}</div>}
        {leftTab === 'effects' && <section className="ed-add ed-clip-effect-browser" aria-label="Clip effects">
          <div className="ed-effect-browser-head"><div><h3>Apply to selected clip</h3><p>Changes the clip itself. Fine-tune it in Settings on the right.</p></div>{selected && <span className="ed-selected-pill">{activeClipEffects.length ? `${activeClipEffects.length} applied` : 'Clip selected'}</span>}</div>
          {!selected && <div className="ed-effect-empty"><b>Select a clip first</b><span>Click a photo or video on the timeline, then apply an effect here.</span></div>}
          {(['Stylise', 'Motion', 'Shape', 'Film', 'Signal', 'Lens'] as const).map((group) => { const matches = matchingClipEffects.filter((preset) => preset.group === group); if (!matches.length) return null; const section = `clip-${group}`; const open = Boolean(effectNeedle) || effectSection === section; return <div key={group} className="ed-effect-category">
            <button className="ed-effect-category-head" aria-expanded={open} onClick={() => { if (!effectNeedle) setEffectSection(open ? null : section); }}><span><b>{group}</b><small>{matches.map((preset) => preset.label).join(' · ')}</small></span>{open ? <Minus size={14}/> : <Plus size={14}/>}</button>
            {open && <div className="ed-clip-effect-grid">{matches.map((preset) => { const applied = clipEffectApplied(preset.id); return <button key={preset.id} className={`ed-clip-effect-card fx-clip-${preset.id} ${applied ? 'on' : ''}`} {...draggableAs({ kind: 'clip_effect', effect: preset.id })} aria-pressed={applied} onClick={() => applyClipEffect(preset.id)} title={selected ? `${applied ? 'Edit' : 'Apply'} ${preset.label} on the selected clip, or drag it onto another clip` : `Drag ${preset.label} onto a timeline clip`}>
              <span className="ed-clip-effect-art">{applied ? <Check size={15}/> : <WandSparkles size={15}/>}</span><span><b>{preset.label}</b><small>{preset.about}</small><em>{applied ? 'Applied · edit on right' : 'Apply to clip'}</em></span></button>; })}</div>
            }
          </div>; })}
        </section>}
        <MediaTabSection2/>
        {leftTab === 'effects' && (!effectNeedle || matchingOverlayEffects.length > 0 || 'thunder weather sound'.includes(effectNeedle)) && <section className="ed-add" aria-label="Special effects">
          <h3>Add an overlay</h3><p className="ed-tip">Effects sit above your video as layers. Click to add at the playhead, or drag onto the timeline.</p>
          {(['weather', 'celebration', 'wedding', 'festival', 'travel', 'vlog'] as const).map((mood) => { const group = matchingOverlayEffects.filter((effect) => effect.mood === mood); const thunderMatches = mood === 'weather' && (!effectNeedle || 'thunder weather sound'.includes(effectNeedle)); const label = { weather: 'Weather', celebration: 'Celebration', wedding: 'Wedding', festival: 'Festival', travel: 'Travel', vlog: 'Vlog and film' }[mood]; const section = `overlay-${mood}`; const open = Boolean(effectNeedle) || effectSection === section; return (group.length > 0 || thunderMatches) && <div key={mood} className="ed-effect-category">
            <button className="ed-effect-category-head" aria-expanded={open} onClick={() => { if (!effectNeedle) setEffectSection(open ? null : section); }}><span><b>{label}</b><small>{group.length + (thunderMatches ? 1 : 0)} effects</small></span>{open ? <Minus size={14}/> : <Plus size={14}/>}</button>
            {open && <>{mood === 'weather' && <details className="ed-weather-custom" data-keep-panel><summary>Customize weather</summary><div className="ed-weather-settings">
              <details className="ed-weather-block"><summary>Rain</summary>
                <ValueSlider label="Amount" value={weather.rainDensity} min={0.25} max={2} step={0.25} defaultValue={1} unit="%" factor={100} onChange={(rainDensity) => setWeather({ ...weather, rainDensity })}/>
                <ValueSlider label="Fall speed" value={weather.rainSpeed} min={0.6} max={1.6} step={0.1} defaultValue={1} unit="×" decimals={1} onChange={(rainSpeed) => setWeather({ ...weather, rainSpeed })}/>
                <Chips label="Wind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.rainDirection} onPick={(rainDirection) => setWeather({ ...weather, rainDirection })}/></details>
              <details className="ed-weather-block"><summary>Fog</summary>
                <ValueSlider label="Density" value={weather.fogDensity} min={0.2} max={1.25} step={0.05} defaultValue={0.65} unit="%" factor={100} onChange={(fogDensity) => setWeather({ ...weather, fogDensity })}/>
                <ValueSlider label="Drift speed" value={weather.fogSpeed} min={0.2} max={1.4} step={0.1} defaultValue={0.55} unit="×" decimals={1} onChange={(fogSpeed) => setWeather({ ...weather, fogSpeed })}/>
                <Chips label="Drift" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.fogDirection} onPick={(fogDirection) => setWeather({ ...weather, fogDirection })}/></details>
              <details className="ed-weather-block"><summary>Lightning</summary>
                <ValueSlider label="Flashes" value={weather.frequency} min={1} max={6} step={1} defaultValue={3} onChange={(frequency) => setWeather({ ...weather, frequency })}/>
                <ValueSlider label="Brightness" value={weather.brightness} min={0.25} max={1.25} step={0.05} defaultValue={0.8} unit="%" factor={100} onChange={(brightness) => setWeather({ ...weather, brightness })}/></details>
              <details className="ed-weather-block"><summary>Snow</summary>
                <ValueSlider label="Amount" value={weather.snowDensity} min={0.25} max={1.75} step={0.25} defaultValue={0.8} unit="%" factor={100} onChange={(snowDensity) => setWeather({ ...weather, snowDensity })}/>
                <ValueSlider label="Fall speed" value={weather.snowSpeed} min={0.4} max={1.5} step={0.1} defaultValue={0.8} unit="×" decimals={1} onChange={(snowSpeed) => setWeather({ ...weather, snowSpeed })}/>
                <Chips label="Wind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.snowDirection} onPick={(snowDirection) => setWeather({ ...weather, snowDirection })}/></details>
              <button className="ed-button wide" disabled={Boolean(effectBusy)} onClick={() => setWeather({ ...weather, seed: (weather.seed + 1) % 100 })}><Shuffle size={13}/>New variation · {weather.seed + 1}</button>
              <p className="ed-tip">Optional controls for the next weather effect you add.</p>
            </div></details>}
            <div className="ed-quick ed-effects">{group.map((effect) => <button key={effect.id} className={`ed-quick-tile fx-${effect.id}`} {...draggableAs({ kind: 'effect', effect: effect.id })} disabled={!total || Boolean(effectBusy)} onClick={() => { void addEffect(effect.id); }} title={`${effect.about}. Click to add at the playhead, or drag onto the timeline.`}>
              <span className="ed-quick-art">{effectBusy?.id === effect.id && <LoaderCircle className="spin" size={14}/>}</span><b>{effect.label}</b><em lang="ta">{effect.tamil}</em></button>)}{thunderMatches && <button className="ed-quick-tile fx-thunder" disabled={!total || thunderBusy} onClick={() => { void addThunder(); }} title="Add locally generated thunder at the playhead. It is an editable sound clip.">
                <span className="ed-quick-art">{thunderBusy && <LoaderCircle className="spin" size={14}/>}</span><b>Thunder</b><em lang="ta">இடி</em></button>}</div></>}
          </div>; })}
          {effectBusy && <p className="ed-tip" role="status">Making the effect for this video's shape… {effectBusy.progress}%. Next time it's instant.</p>}
          {!effects.length && <p className="ed-tip">Loading effects…</p>}
        </section>}
        {leftTab === 'effects' && effectNeedle && !matchingClipEffects.length && !matchingOverlayEffects.length && !'thunder weather sound hide blur pixelate face privacy'.includes(effectNeedle) && <div className="ed-effect-empty"><b>No effects found</b><span>Try a name such as film, rain, VHS, wedding or light.</span></div>}
        {leftTab === 'effects' && (!effectNeedle || 'privacy hide blur pixelate face'.includes(effectNeedle)) && <section className="ed-add" aria-label="Privacy"><h3 className="ed-sub">{t('Privacy')}</h3><p className="ed-tip">Covers a face, a number plate or a screen. It can follow what it covers.</p>
            <div className="ed-add-grid">
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('blur')}><EyeOff size={13}/>Blur box</button>
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('pixelate')}><EyeOff size={13}/>Pixelate box</button>
              {faceJob ? <div className="ed-add-span"><div className="ed-progress"><i style={{ width: `${faceJob.progress}%` }}/></div><p className="ed-tip">Finding faces… {faceJob.progress}%</p><button className="ed-button wide" onClick={() => { void cancelRenderJob(faceJob.jobId); setFaceJob(null); }}>Cancel</button></div>
                : <button className="ed-button ed-add-span" disabled={!total} onClick={() => { void blurFaces(); }} title="Finds every face in the clip at the playhead and blurs each one"><ScanFace size={14}/>Blur faces</button>}
            </div>
            {faceNote && <p className="ed-tip" role="status">{faceNote}</p>}</section>}
        {leftTab === 'text' && <>
          <section className="ed-add" aria-label="Titles"><h3 className="ed-sub">Titles</h3><p className="ed-tip">Click to add at the playhead, or drag onto the timeline, then type your words.</p>
            <div className="ed-templates">{TEMPLATES.map((template) => <button key={template.id} className="ed-template" {...draggableAs({ kind: 'title', template: template.id })} onClick={() => addTitle(template)} title={`Add a ${template.label} title`}>
              <span className="ed-template-art">{thumbs[template.id] ? <img src={thumbs[template.id]} alt=""/> : <Type size={16}/>}</span><span>{template.label}</span></button>)}</div>
            {myStyles.length > 0 && <><h3 className="ed-sub">My styles</h3><div className="ed-templates">{myStyles.map((style) => <div key={style.id} className="ed-template-wrap">
              <button className="ed-template" {...draggableAs({ kind: 'title', template: style.id })} onClick={() => addTitle(style)} title="Add a title in this style"><span className="ed-template-art">{thumbs[style.id] ? <img src={thumbs[style.id]} alt=""/> : <Type size={16}/>}</span><span>{style.label}</span></button>
              <button className="ed-icon small ed-template-forget" aria-label={`Forget the style ${style.label}`} title="Forget this style" onClick={() => forgetStyle(style.id)}><X size={12}/></button></div>)}</div></>}</section>
          <section className="ed-add" aria-label="Captions"><h3 className="ed-sub">Captions</h3>
            {layout.simple ? <>
              <p className="ed-tip">Writes the words people say, timed to their speech.</p>
              {captionsWaiting && wordJob ? <p className="ed-tip" role="status">Listening to your video… {wordJob.progress}%</p>
                : <button className="ed-button wide" disabled={!total} onClick={() => makeCaptions()}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}
            </> : <>
            <p className="ed-tip">Turns the speech in your main track into captions{timeline && captionLayers(timeline).length ? '. Making them again replaces the old ones.' : '.'}</p>
            <label className="ed-words-language"><span>{t('Spoken language')}</span><KanaaSelect aria-label={t('Spoken language')} value={language} onChange={(event) => { setLanguage(event.target.value); try { localStorage.setItem('wa.wordsLanguage', event.target.value); } catch { /* the choice just isn't remembered */ } }}>{LANGUAGES.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}</KanaaSelect></label>
            <div className="ed-add-row"><span>Words per caption</span><div className="ed-chips ed-even" role="group" aria-label="Words per caption">{[1, 2, 3, 4].map((count) => <button key={count} className={captionWords === count ? 'on' : ''} aria-pressed={captionWords === count} onClick={() => setCaptionWords(count)}>{count}</button>)}</div></div>
            {captionsWaiting && wordJob ? <><div className="ed-progress"><i style={{ width: `${wordJob.progress}%` }}/></div><p className="ed-tip">Listening to your video… {wordJob.progress}%. The captions follow.</p></>
              : <button className="ed-button wide" disabled={!total} onClick={() => makeCaptions()}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}
            {timeline && captionLayers(timeline).some((layer) => layer.items.length) && <button className="ed-button wide" disabled={clearing} onClick={() => { void keepClearOfFaces(); }} title="A caption that would cover someone's face moves to the top for that moment"><ScanFace size={14}/>{clearing ? 'Looking for faces…' : 'Keep captions clear of faces'}</button>}
            {clearNote && <p className="ed-tip" role="status">{clearNote}</p>}</>}</section>
        </>}
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
