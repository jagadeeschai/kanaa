import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music, Sparkles, X } from 'lucide-react';
import { exportProjectTimeline, startDepthMotion } from '../api/client';
import { exportFormat } from '../timeline/model';
import { cancelRenderJob, createProject, getSongBeats, getJobStatus, getPhoto, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, saveVideoProject, startLyricSync, startVideoExport, uploadVideoAudio, videoAudioUrl, type Project } from '../api/client';
import type { JobStatusResponse, Photo } from '../types/photo';
import { buildLyricTimeline, cuesToLrc, cuesToSrt, hasLyricTimings, plainLyricLines, reconcileLyricCues, validateLyricCues, type LyricCue } from '../utils/lyrics';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useVideoProject } from '../hooks/useVideoProject';
import ImportArea from './ImportArea';
import LyricImageGenerator from './LyricImageGenerator';
import KanaaSelect from './KanaaSelect';
import LyricSyncFix from './LyricSyncFix';
import { isSongFile, startImageAt, computeSlideStarts, crossfadeSeconds, slideIndexAt, slideTransform, type ImageAnimation, type SlideTiming } from '../utils/slides';
import { nextTabIndex } from '../editor/tab-navigation';
import { mediaCanvas, type LyricCanvas } from '../editor/lyric-canvas';
import { lyricEditorTimeline } from '../editor/lyric-handoff';

// Same bundled fonts as the export, loaded in index.css, so the preview matches it.
const LYRIC_FONT_STACK = "'Noto Sans', 'Noto Sans Tamil', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Gurmukhi', 'Noto Sans Gujarati', 'Noto Sans Telugu', 'Noto Sans Kannada', 'Noto Sans Malayalam', sans-serif";
// Lyric size scales with frame width, so wide frames need a smaller value to read the same.
const DEFAULT_LYRIC_SIZE = 44;
const LANDSCAPE_LYRIC_SIZE = 28;
const inputClass = 'theme-control w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100';
const buttonClass = 'theme-control rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 disabled:opacity-40';
type Job = { id: string; kind: 'sync' | 'export'; status: JobStatusResponse | null };
type LyricCanvasChoice = 'auto' | LyricCanvas;
type LyricStyle = 'outline' | 'shadow' | 'band';
type LyricFont = 'standard' | 'elegant' | 'modern' | 'playful' | 'handwritten';
type LyricAlign = 'left' | 'center' | 'right';
type LyricAnimation = 'none' | 'fade' | 'slide-up' | 'pop' | 'cinematic';
type PlacementMode = 'fixed' | 'alternate' | 'per-line';
type LyricRecipe = {
  version: 1;
  /** The step the person was on, and the steps they have looked at: reopening goes back there. */
  stage?: LyricStage;
  visited?: LyricStage[];
  clips: { photo_id: number }[];
  song: { id: string; name: string; duration: number } | null;
  lyrics: string;
  cues: LyricCue[];
  language: string;
  canvas: LyricCanvasChoice;
  color: string;
  fontSize: number;
  placement: 'top' | 'center' | 'bottom';
  imageAnimation: ImageAnimation;
  lyricAnimation: LyricAnimation;
  slideTiming?: SlideTiming;
  storyboardStarts?: number[];
  crossfade?: boolean;
  quality?: '720p' | '1080p' | '4k';
  lyricStyle?: LyricStyle;
  lyricFont?: LyricFont;
  lyricAlign?: LyricAlign;
  lyricBandColor?: string;
  placementMode?: PlacementMode;
};
type LyricStage = 'background' | 'song' | 'timing' | 'style' | 'export';
const LYRIC_STAGES: { id: LyricStage; label: string }[] = [{ id: 'song', label: 'Song & words' }, { id: 'background', label: 'Scenes & background' }, { id: 'timing', label: 'Timing' }, { id: 'style', label: 'Style' }, { id: 'export', label: 'Export' }];
const LYRIC_FONTS: { id: LyricFont; label: string; family: string }[] = [
  { id: 'standard', label: 'Clean', family: LYRIC_FONT_STACK }, { id: 'elegant', label: 'Elegant', family: 'Arima' },
  { id: 'modern', label: 'Modern', family: 'Catamaran' }, { id: 'playful', label: 'Playful', family: 'Baloo Thambi 2' },
  { id: 'handwritten', label: 'Handwritten', family: 'Kavivanar' },
];
const LYRIC_PRESETS: { id: string; label: string; font: LyricFont; style: LyricStyle; color: string; band: string; animation: LyricAnimation; placement: 'top' | 'center' | 'bottom' }[] = [
  { id: 'cinematic', label: 'Cinematic', font: 'elegant', style: 'shadow', color: '#ffffff', band: '#000000', animation: 'fade', placement: 'center' },
  { id: 'festival', label: 'Festival', font: 'playful', style: 'outline', color: '#ffd400', band: '#7c3aed', animation: 'pop', placement: 'center' },
  { id: 'bold', label: 'Bold reel', font: 'modern', style: 'band', color: '#ffffff', band: '#dc2626', animation: 'pop', placement: 'center' },
  { id: 'minimal', label: 'Minimal', font: 'standard', style: 'shadow', color: '#ffffff', band: '#000000', animation: 'fade', placement: 'bottom' },
];

const LYRIC_STYLE_CSS: Record<LyricStyle, React.CSSProperties> = {
  outline: { textShadow: '0 1px 3px #000, 1px 0 #111, -1px 0 #111' },
  shadow: { textShadow: '0 2px 10px rgba(0,0,0,.85), 0 0 22px rgba(0,0,0,.55)' },
  band: {},
};

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const LINE_TYPE = 'application/x-kanaa-lyric-line';

export default function LyricalVideoCreator({ photo, projectId, projectName, onClose, onOpenOutput, onContinueInEditor }: { photo: Photo; projectId: number; projectName: string; onClose: () => void; onOpenOutput?: (id: number) => void; onContinueInEditor: (project: Project) => void }) {
  const [backgrounds, setBackgrounds] = useState<Photo[]>([photo]);
  const [backgroundType, setBackgroundType] = useState<'image' | 'video'>(photo.media_type === 'video' ? 'video' : 'image');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPhotos, setPickerPhotos] = useState<Photo[]>([]);
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [imageAnimation, setImageAnimation] = useState<ImageAnimation>('ken-burns');
  const [slideTiming, setSlideTiming] = useState<SlideTiming>('lyrics');
  const [crossfade, setCrossfade] = useState(true);
  const [inScene, setInScene] = useState(false);
  const [making3d, setMaking3d] = useState<string | null>(null);
  const [quality, setQuality] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [lyricStyle, setLyricStyle] = useState<LyricStyle>('band');
  const [lyricFont, setLyricFont] = useState<LyricFont>('standard');
  const [lyricAlign, setLyricAlign] = useState<LyricAlign>('center');
  const [lyricBandColor, setLyricBandColor] = useState('#000000');
  const [storyboardStarts, setStoryboardStarts] = useState<number[]>([]);
  const [beats, setBeats] = useState<{ songId: string; times: number[]; bpm: number } | null>(null);
  const [lyricAnimation, setLyricAnimation] = useState<LyricAnimation>('none');
  const [lyrics, setLyrics] = useState('');
  const [cues, setCues] = useState<LyricCue[]>([]);
  const [undoLyrics, setUndoLyrics] = useState<{ lyrics: string; cues: LyricCue[] } | null>(null);
  const [song, setSong] = useState<{ id: string; duration: number; name: string; url: string } | null>(null);
  const [language, setLanguage] = useState('');
  const [canvas, setCanvas] = useState<LyricCanvasChoice>('auto');
  const [color, setColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState(DEFAULT_LYRIC_SIZE);
  const [placement, setPlacement] = useState<'top' | 'center' | 'bottom'>('bottom');
  const [placementMode, setPlacementMode] = useState<PlacementMode>('alternate');
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStageState] = useState<LyricStage>('song');
  const [visited, setVisited] = useState<LyricStage[]>(['song']);
  const setStage = (next: LyricStage) => { setStageState(next); setVisited((seen) => (seen.includes(next) ? seen : [...seen, next])); };
  /** A song file being dragged over the window, and the image a lyric line is hovering. */
  const [songOver, setSongOver] = useState(false);
  const [lineOver, setLineOver] = useState<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 500 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lockRef = useRef(false);
  const closeRef = useRef(() => {});
  useFocusTrap(dialogRef, true);
  const firstBackground = backgrounds[0];
  const resolvedCanvas = canvas === 'auto' ? mediaCanvas(firstBackground?.width, firstBackground?.height) : canvas;
  const isVideo = firstBackground?.media_type === 'video';
  const duration = song?.duration ?? firstBackground?.duration ?? 0;
  const slideStarts = useMemo(
    () => computeSlideStarts(backgrounds.length, duration, slideTiming, cues, beats?.songId === song?.id ? beats?.times ?? [] : [], storyboardStarts),
    [backgrounds.length, duration, slideTiming, cues, beats, song?.id, storyboardStarts],
  );
  const slideIndex = slideIndexAt(slideStarts, position);
  const activeBackground = backgrounds[Math.max(0, slideIndex)];
  const fadeSeconds = crossfade ? crossfadeSeconds(slideStarts, duration) : 0;
  const fadeProgress = fadeSeconds > 0 && slideIndex > 0 ? Math.min(1, (position - slideStarts[slideIndex]) / fadeSeconds) : 1;
  const busy = starting || uploading || handingOff || Boolean(job && !job.status?.done);
  const valid = validateLyricCues(cues, duration);
  /** Which steps are finished: a tick on the step list, and Next lights up. */
  const done: Record<LyricStage, boolean> = {
    song: Boolean(song) && Boolean(lyrics.trim()),
    background: backgrounds.length > 0,
    timing: cues.length > 0 && valid,
    style: visited.includes('style'),
    export: job?.kind === 'export' && Boolean(job.status?.done) && !job.status?.error,
  };
  const ratio = resolvedCanvas === 'portrait' ? 9 / 16 : resolvedCanvas === 'square' ? 1 : 16 / 9;
  const previewWidth = Math.min(stageSize.width - 24, (stageSize.height - 24) * ratio);
  const positionForCue = (cue: LyricCue, index: number) => cue.position ?? (placementMode === 'alternate' ? (index % 2 ? 'bottom' : 'top') : placement);
  const currentCueIndex = cues.findIndex((cue) => position >= cue.start && position < cue.end);
  const currentCue = currentCueIndex >= 0 ? cues[currentCueIndex] : undefined;
  const currentPlacement = currentCue ? positionForCue(currentCue, currentCueIndex) : placement;
  const lyricFontFamily = LYRIC_FONTS.find((item) => item.id === lyricFont)?.family ?? LYRIC_FONT_STACK;
  const cueProgress = currentCue ? Math.min(1, Math.max(0, (position - currentCue.start) / Math.min(.25, (currentCue.end - currentCue.start) / 3))) : 1;
  const cueTransform = `${currentPlacement === 'center' ? 'translateY(-50%) ' : ''}${lyricAnimation === 'pop' ? `scale(${.7 + .3 * cueProgress})` : lyricAnimation === 'cinematic' ? `perspective(700px) rotateX(10deg) translateZ(${-400 * (1 - cueProgress)}px)` : ''}`.trim() || undefined;
  const songBaseName = song?.name.replace(/\.[^.]+$/, '') || 'lyrics';
  const outputId = job?.kind === 'export' && job.status?.done && !job.status.error ? job.status.output_photo_id : null;

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setPickerLoading(true);
    const timer = setTimeout(() => {
      void listPhotos({ library_id: photo.library_id, media_type: backgroundType, q: pickerSearch, limit: 24, offset: pickerPage * 24 }).then((result) => {
        if (!cancelled) { setPickerPhotos(result.photos); setPickerTotal(result.total); }
      }).catch((problem) => { if (!cancelled) setError(problem.message); }).finally(() => { if (!cancelled) setPickerLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pickerOpen, backgroundType, pickerPage, pickerSearch, photo.library_id]);

  const pause = () => { videoRef.current?.pause(); audioRef.current?.pause(); setPlaying(false); };
  // The project autosaves and jobs continue in the Exports page, so leaving is always safe.
  const close = () => { pause(); onClose(); };
  const hasWork = true;
  const project = useVideoProject<LyricRecipe>(projectId, 'lyric', hasWork ? {
    version: 1, clips: backgrounds.map((item) => ({ photo_id: item.id })), song: song && { id: song.id, name: song.name, duration: song.duration },
    lyrics, cues, language, canvas, color, fontSize, placement, placementMode, imageAnimation, lyricAnimation, slideTiming, storyboardStarts, crossfade, quality, lyricStyle, lyricFont, lyricAlign, lyricBandColor, stage, visited,
  } : null, async (recipe) => {
    setLyrics(recipe.lyrics ?? ''); setCues(recipe.cues ?? []); setLanguage(recipe.language ?? ''); setCanvas(recipe.canvas ?? 'auto'); setColor(recipe.color ?? '#ffffff');
    setFontSize(recipe.fontSize ?? 44); setPlacement(recipe.placement ?? 'bottom'); setPlacementMode(recipe.placementMode ?? 'fixed'); setImageAnimation(recipe.imageAnimation ?? 'none'); setLyricAnimation(recipe.lyricAnimation ?? 'none');
    setSlideTiming(recipe.slideTiming ?? 'even'); setStoryboardStarts(recipe.storyboardStarts ?? []); setCrossfade(recipe.crossfade ?? false); setQuality(recipe.quality ?? '720p'); setLyricStyle(recipe.lyricStyle ?? 'outline');
    if (recipe.stage && LYRIC_STAGES.some((item) => item.id === recipe.stage)) setStageState(recipe.stage);
    if (recipe.visited?.length) setVisited(recipe.visited);
    setLyricFont(recipe.lyricFont ?? 'standard'); setLyricAlign(recipe.lyricAlign ?? 'center'); setLyricBandColor(recipe.lyricBandColor ?? '#000000');
    if (recipe.song) setSong({ ...recipe.song, url: videoAudioUrl(recipe.song.id) });
    await Promise.all((recipe.clips ?? []).map((clip) => getPhoto(clip.photo_id).catch(() => null))).then((photos) => {
      const available = photos.filter((item): item is Photo => item !== null);
      if (available.length) { setBackgrounds(available); setBackgroundType(available[0].media_type === 'video' ? 'video' : 'image'); }
    });
    setNotice(recipe.stage && recipe.stage !== 'song' ? `Restored your saved project, on ${LYRIC_STAGES.find((item) => item.id === recipe.stage)?.label}.` : 'Restored your saved project.');
  });
  closeRef.current = close;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); closeRef.current(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => setStageSize({ width: stage.clientWidth, height: stage.clientHeight }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (song?.url.startsWith('blob:')) URL.revokeObjectURL(song.url); }, [song]);

  useEffect(() => {
    if (!job || job.status?.done) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await getJobStatus(job.id);
        if (cancelled) return;
        setJob({ ...job, status });
        if (status.done) {
          if (status.error) setError(status.error);
          else if (job.kind === 'sync' && status.lyric_cues) { if (cues.length) setUndoLyrics({ lyrics, cues }); setCues(status.lyric_cues); setNotice(status.warning || 'Lyrics synced. Preview the timing before export.'); }
          return;
        }
      } catch (problem) {
        if (cancelled) return;
        const message = problem instanceof Error ? problem.message : 'Could not check progress.';
        setError(message);
        if (message.toLowerCase().includes('not found')) { setJob(null); return; }
      }
      if (!cancelled) timer = setTimeout(poll, 900);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [job?.id, job?.status?.done]);

  const upload = async (file: File) => {
    if (lockRef.current) return;
    if (file.size > 100 * 1024 * 1024) { setError('Choose a song smaller than 100 MB.'); return; }
    lockRef.current = true; setUploading(true); setError(null); pause();
    try {
      const asset = await uploadVideoAudio(file);
      setSong({ id: asset.asset_id, duration: asset.duration, name: file.name, url: URL.createObjectURL(file) });
      const fromFile = asset.embedded_lyrics && !lyrics.trim() ? plainLyricLines(asset.embedded_lyrics).join('\n') : '';
      if (fromFile) setLyrics(fromFile);
      setPosition(0); setCues([]); setJob(null); setNotice(fromFile ? 'Found lyrics inside the song file. Check them, then choose Auto-sync lyrics.' : 'Paste the song lyrics and choose Auto-sync lyrics.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Song upload failed.'); }
    finally { lockRef.current = false; setUploading(false); }
  };
  const continueInEditor = async () => {
    if (busy || !song || !firstBackground || !valid || !cues.length) return;
    setHandingOff(true); setError(null); setNotice(null); pause();
    try {
      const placedCues = cues.map((cue, index) => ({ ...cue, position: positionForCue(cue, index) }));
      const timeline = lyricEditorTimeline({ name: projectName, backgrounds, backgroundType, duration, slideStarts, song, cues: placedCues, canvas: resolvedCanvas, color, fontSize, placement, lyricStyle, lyricFont, lyricAlign, lyricBandColor, lyricAnimation, crossfade, imageAnimation });
      const next = await createProject(`${projectName} – final edit`, 'edit', backgrounds.map((item) => item.id));
      await saveVideoProject(next.id, 'edit', timeline);
      onContinueInEditor(next);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not open this lyric video in the Video Editor.'); }
    finally { setHandingOff(false); }
  };
  const start = async (kind: 'sync' | 'export') => {
    if (lockRef.current || busy) return;
    if (kind === 'sync' && (!song || !plainLyricLines(lyrics).length)) { setError('Upload a song and paste its lyrics first.'); return; }
    if (kind === 'sync' && plainLyricLines(lyrics).some((line) => line.length > 500)) { setError('Keep each lyric line under 500 characters.'); return; }
    if (kind === 'export' && (!valid || !firstBackground || (!isVideo && !song))) { setError('Check the lyric timeline before exporting.'); return; }
    lockRef.current = true; setStarting(true); setError(null); setNotice(null); pause();
    try {
      // Cinematic lyrics are drawn by the timeline renderer (3D letters, perspective entrances), the same as in the editor.
      const want3d = kind === 'export' && imageAnimation === '3d' && !isVideo;
      const viaTimeline = kind === 'export' && (lyricAnimation === 'cinematic' || want3d) && song;
      let depthVideos: Record<number, number> | undefined;
      if (viaTimeline && want3d) {
        depthVideos = {};
        for (const [index, item] of backgrounds.entries()) {
          setMaking3d(`Making picture ${index + 1} of ${backgrounds.length} 3D…`);
          const length = (slideStarts[index + 1] ?? duration) - (slideStarts[index] ?? 0) + 0.2;
          let made = await startDepthMotion(item.id, Math.max(0.5, Math.min(120, length)), (['push', 'drift', 'rise'] as const)[index % 3]);
          while (made.status !== 'ready' && made.job_id) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            const status = await getJobStatus(made.job_id) as unknown as { status?: string; error?: string | null; output_photo_id?: number | null };
            if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the 3D picture.');
            if (status.status === 'done' && status.output_photo_id) made = { status: 'ready', output_photo_id: status.output_photo_id };
          }
          depthVideos[item.id] = made.output_photo_id!;
        }
        setMaking3d(null);
      }
      const result = viaTimeline
        ? await (() => { const timeline = lyricEditorTimeline({ name: projectName, backgrounds, backgroundType, duration, slideStarts, song: song!, cues: cues.map((cue, index) => ({ ...cue, position: positionForCue(cue, index) })), canvas: resolvedCanvas, color, fontSize, placement, lyricStyle, lyricFont, lyricAlign, lyricBandColor, lyricAnimation, crossfade, imageAnimation, depthVideos, inScene: inScene && Boolean(depthVideos) });
          return exportProjectTimeline(projectId, { ...timeline, format: exportFormat(timeline.format, quality === '4k' ? 2160 : quality === '720p' ? 720 : 1080) }); })()
        : kind === 'sync'
        ? await startLyricSync(song!.id, plainLyricLines(lyrics).join('\n'), language || null)
        : await startVideoExport(firstBackground.id, { background_photo_ids: isVideo ? [] : backgrounds.map((item) => item.id), image_animation: imageAnimation === '3d' ? 'zoom-in' : imageAnimation, slide_starts: isVideo ? [] : slideStarts, transition: crossfade ? 'crossfade' : 'none', quality, lyric_style: lyricStyle, lyric_animation: lyricAnimation === 'cinematic' ? 'fade' : lyricAnimation, lyric_font: lyricFont, lyric_align: lyricAlign, lyric_band_color: lyricBandColor, trim_start: 0, trim_end: duration, rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1, volume: 1, mute: false, audio_asset_id: song?.id, canvas: resolvedCanvas, lyrics: cues.map(({ start, end, text }, index) => ({ start, end, text, position: positionForCue(cues[index], index) })), lyric_color: color, lyric_size: fontSize, lyric_position: placement });
      setJob({ id: result.job_id, kind, status: null });
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not start the job.'); }
    finally { lockRef.current = false; setStarting(false); setMaking3d(null); }
  };
  useEffect(() => {
    if (slideTiming !== 'beats' || !song || beats?.songId === song.id) return;
    let cancelled = false;
    getSongBeats(song.id).then((result) => {
      if (cancelled) return;
      setBeats({ songId: song.id, times: result.beats, bpm: result.bpm });
      if (!result.beats.length) setNotice('No steady beat was found, so images keep even timing.');
    }).catch((problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : 'Could not detect the beat.'); });
    return () => { cancelled = true; };
  }, [slideTiming, song?.id, beats?.songId]);
  const changeLyrics = (text: string) => {
    setLyrics(text);
    setNotice(null);
    if (hasLyricTimings(text)) {
      // Timed text is its own timeline; while it's mid-edit and unreadable, keep the last good one.
      try { setCues(buildLyricTimeline(text, duration)); } catch { /* keep current timings */ }
    } else {
      setCues((previous) => reconcileLyricCues(previous, text));
    }
  };
  const seek = (value: number) => {
    setPosition(value);
    if (audioRef.current) audioRef.current.currentTime = value;
    if (videoRef.current) videoRef.current.currentTime = song && firstBackground?.duration ? value % firstBackground.duration : value;
  };
  const play = async () => {
    if (playing) { pause(); return; }
    if (position >= duration - 0.05) seek(0);
    try { await videoRef.current?.play(); if (song) await audioRef.current?.play(); setPlaying(true); }
    catch { pause(); setError('The browser could not play this media. You can still export supported files.'); }
  };
  useEffect(() => {
    videoRef.current?.pause();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setPlaying(false); setPosition(0);
  }, [backgrounds]);
  const editCue = (index: number, changes: Partial<LyricCue>) => {
    if (changes.start !== undefined) changes.start = Math.round(changes.start * 1000) / 1000;
    if (changes.end !== undefined) changes.end = Math.round(changes.end * 1000) / 1000;
    setCues((previous) => previous.map((cue, current) => current === index ? { ...cue, ...changes, review: false } : cue));
  };

  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  /** Drop a song anywhere in the lyric editor. */
  const onSongDrop = (event: React.DragEvent) => {
    setSongOver(false);
    // The media import area takes its own drops (pictures and videos).
    if (!hasFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find(isSongFile);
    if (!file) { setError('Drop an audio file (MP3, WAV, M4A, AAC, FLAC or OGG) to use it as the song.'); return; }
    void upload(file);
  };
  /** Drop a lyric line onto an image: the image starts with that line. */
  const onLineDrop = (event: React.DragEvent, index: number) => {
    setLineOver(null);
    const line = Number(event.dataTransfer.getData(LINE_TYPE));
    if (!event.dataTransfer.types.includes(LINE_TYPE) || !cues[line]) return;
    event.preventDefault();
    const next = startImageAt(slideStarts, index, cues[line].start, duration);
    if (!next) { setError(`Image ${index + 1} can't start there: it must come at least a second after image ${index} and before the next image.`); return; }
    pause(); setStoryboardStarts(next); setSlideTiming('storyboard'); setError(null);
    setNotice(`Image ${index + 1} now starts with “${cues[line].text.slice(0, 40)}”.`);
  };

  return createPortal(<>
    <div className="theme-overlay fixed inset-0 z-[110] bg-black/70 sm:p-4" onDragOver={(event) => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setSongOver(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setSongOver(false); }} onDrop={onSongDrop}>
      {songOver && <div className="pointer-events-none fixed inset-4 z-[120] grid place-items-center rounded-2xl border-2 border-dashed border-brand-400 bg-black/60 text-lg font-medium text-brand-100">{uploading ? 'Adding song…' : 'Drop your song to use it here'}</div>}
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Lyrical video creator" className="theme-modal flex h-full flex-col overflow-hidden border border-white/10 bg-slate-950 outline-none sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><div><h2 className="text-base font-semibold text-slate-100">{projectName}</h2><p className="text-xs text-slate-400">{LYRIC_STAGES.find((item) => item.id === stage)?.label} · {project.saveFailed ? 'Save failed' : project.saving ? 'Saving…' : 'Saved'}</p></div><button onClick={close} aria-label="Close lyrical creator" className={buttonClass}><span className="flex items-center gap-2"><span className="hidden sm:inline">Back to studio</span><X className="h-4 w-4" /></span></button></header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="sticky top-0 z-10 flex shrink-0 flex-col bg-white lg:static lg:min-w-0 lg:flex-1">
            <div ref={stageRef} className="flex h-[28dvh] min-h-40 items-center justify-center overflow-hidden bg-black lg:h-auto lg:flex-1">
              <div className="relative overflow-hidden bg-black" style={{ width: Math.max(1, previewWidth), aspectRatio: String(ratio) }}>
                {isVideo && firstBackground ? <video key={firstBackground.id} ref={videoRef} src={photoVideoUrl(firstBackground.id)} poster={photoThumbUrl(firstBackground.id)} preload="metadata" loop={Boolean(song)} muted={Boolean(song)} className="h-full w-full object-cover" aria-label="Lyrical video preview" onTimeUpdate={(event) => { if (!song) setPosition(event.currentTarget.currentTime); }} onEnded={() => { if (!song) setPlaying(false); }} /> : activeBackground ? <>
                  {fadeProgress < 1 && <img src={photoImageUrl(backgrounds[slideIndex - 1].id)} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: slideTransform(imageAnimation, slideIndex - 1, slideStarts, duration, fadeSeconds, position) }} />}
                  <img src={photoImageUrl(activeBackground.id)} alt={activeBackground.filename} className="absolute inset-0 h-full w-full object-cover" style={{ opacity: fadeProgress, transform: slideTransform(imageAnimation, slideIndex, slideStarts, duration, fadeSeconds, position) }} />
                </> : <p className="p-4 text-center text-sm text-white">Choose images or a video below</p>}
                {currentCue && <div className="pointer-events-none absolute font-bold" style={{ left: '5.5%', right: '5.5%', color, fontFamily: lyricFontFamily, textAlign: lyricAlign, fontSize: fontSize * previewWidth / 720, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', opacity: lyricAnimation === 'none' ? 1 : cueProgress * (lyricAnimation === 'fade' ? Math.max(0, (currentCue.end - position) / Math.min(.25, (currentCue.end - currentCue.start) / 3)) : 1), translate: lyricAnimation === 'slide-up' ? `0 ${(1 - cueProgress) * previewWidth / ratio * .04}px` : undefined, transform: cueTransform, ...LYRIC_STYLE_CSS[lyricStyle], ...(currentPlacement === 'top' ? { top: '8%' } : currentPlacement === 'bottom' ? { bottom: '8%' } : { top: '50%' }) }}>{lyricStyle === 'band' ? <span style={{ background: `${lyricBandColor}b3`, padding: `${.15 * fontSize * previewWidth / 720}px ${.3 * fontSize * previewWidth / 720}px`, WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }}>{currentCue.text}</span> : currentCue.text}</div>}
              </div>
            </div>
            {song && <audio ref={audioRef} src={song.url} onError={() => { setSong(null); setNotice('The saved song is no longer available. Upload it again.'); }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onEnded={() => pause()} />}
            <div className="space-y-2 border-t border-white/10 p-3"><input aria-label="Lyrical video playhead" type="range" min={0} max={duration || 1} step={0.05} value={Math.min(position, duration || 1)} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-brand-400" /><div className="flex items-center justify-between"><button onClick={() => { void play(); }} className={buttonClass}>{playing ? 'Pause lyrical preview' : 'Play lyrical preview'}</button><span className="text-xs text-slate-400">{position.toFixed(1)} / {duration.toFixed(1)} s</span></div></div>
          </div>
          <aside aria-label="Lyrical video settings" className="border-t border-white/10 lg:w-[28rem] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <nav aria-label="Lyrical video stages" role="tablist" className="lyric-stages sticky top-0 z-10 grid grid-cols-5 gap-1 border-b border-white/10 bg-slate-950 p-3">{LYRIC_STAGES.map((item, index) => <button key={item.id} role="tab" aria-selected={stage === item.id} tabIndex={stage === item.id ? 0 : -1} className={`${stage === item.id ? 'active' : ''} ${done[item.id] ? 'done' : ''}`} onClick={() => setStage(item.id)} onKeyDown={(event) => { const next = nextTabIndex(index, LYRIC_STAGES.length, event.key); if (next === index) return; event.preventDefault(); setStage(LYRIC_STAGES[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus(); }}><span>{done[item.id] && stage !== item.id ? '✓' : index + 1}</span>{item.label}</button>)}</nav>
            <fieldset disabled={busy || !project.loaded} className="space-y-4 p-4 disabled:opacity-60">
              {stage === 'background' && <>
              <section aria-label="Background selection" className="space-y-3 rounded-xl border border-white/10 p-3">
                <h3 className="text-sm font-medium text-slate-200">Background</h3>
                <label className="block text-xs text-slate-400">Video format<KanaaSelect aria-label="Lyrical video format" value={canvas} onChange={(event) => { const next = event.target.value as LyricCanvasChoice; setCanvas(next); const format = next === 'auto' ? mediaCanvas(firstBackground?.width, firstBackground?.height) : next; setFontSize(format === 'landscape' ? LANDSCAPE_LYRIC_SIZE : DEFAULT_LYRIC_SIZE); }} className="mt-1"><option value="auto">Match media ({resolvedCanvas === 'portrait' ? '9:16 portrait' : resolvedCanvas === 'square' ? '1:1 square' : '16:9 landscape'})</option><option value="portrait">Portrait 9:16</option><option value="square">Square 1:1</option><option value="landscape">Landscape 16:9</option></KanaaSelect></label>
                <div className="flex gap-2">{(['image', 'video'] as const).map((type) => <button key={type} aria-pressed={backgroundType === type} onClick={() => { pause(); setBackgroundType(type); setPickerOpen(true); setPickerPage(0); setPickerSearch(''); setPickerPhotos([]); setJob(null); if (backgrounds[0]?.media_type !== type) { setBackgrounds([]); setPosition(0); } }} className={`${buttonClass} ${backgroundType === type ? 'border-brand-400 text-brand-300' : ''}`}>{type === 'image' ? 'Images / slideshow' : 'Video'}</button>)}</div>
                {backgrounds.map((item, index) => <div key={`${item.id}-${index}`} onDragOver={(event) => { if (isVideo || index === 0 || !event.dataTransfer.types.includes(LINE_TYPE)) return; event.preventDefault(); setLineOver(index); }} onDragLeave={() => setLineOver(null)} onDrop={(event) => onLineDrop(event, index)} className={`flex items-center gap-2 rounded text-xs text-slate-300 ${lineOver === index ? 'outline outline-2 outline-brand-400' : ''}`}><img src={photoThumbUrl(item.id)} alt="" className="h-10 w-10 rounded object-cover" /><span className="min-w-0 flex-1 truncate">{index + 1}. {item.filename}{!isVideo && slideStarts[index] !== undefined && <em className="block not-italic text-slate-500">from {slideStarts[index].toFixed(1)}s</em>}</span>{!isVideo && <><button aria-label={`Move image ${index + 1} earlier`} disabled={index === 0} onClick={() => { pause(); setBackgrounds((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); }} className={buttonClass}>↑</button><button aria-label={`Remove image ${index + 1}`} onClick={() => { pause(); setBackgrounds((items) => items.filter((_, i) => i !== index)); }} className={buttonClass}>×</button></>}</div>)}
                <button onClick={() => { setPickerOpen(!pickerOpen); }} className={buttonClass}>{pickerOpen ? 'Close media picker' : backgroundType === 'image' ? 'Add images from media' : 'Choose video from media'}</button>
                {pickerOpen && <div className="space-y-2"><ImportArea compact videoOnly={backgroundType === 'video'} onImported={(items) => { pause(); const matching = items.filter((item) => item.media_type === backgroundType); if (!matching.length) { setNotice(`Imported media. Switch to ${items[0]?.media_type === 'video' ? 'Video' : 'Images'} to use it.`); return; } setBackgrounds((previous) => backgroundType === 'video' ? matching.slice(0, 1) : [...previous, ...matching].slice(0, 50)); setPickerOpen(false); setJob(null); }} /><input aria-label="Search background media" placeholder="Search your media" value={pickerSearch} onChange={(event) => { setPickerSearch(event.target.value); setPickerPage(0); }} className={inputClass} />{pickerLoading ? <p role="status" className="text-xs text-slate-400">Loading media…</p> : <><div className="grid grid-cols-3 gap-2">{pickerPhotos.map((item) => <button key={item.id} aria-label={`Choose ${item.filename}`} disabled={backgroundType === 'image' && (backgrounds.some((selected) => selected.id === item.id) || backgrounds.length >= 50)} onClick={() => { pause(); setJob(null); setPosition(0); if (backgroundType === 'video') { setBackgrounds([item]); setPickerOpen(false); } else setBackgrounds((items) => [...items, item]); }} className="overflow-hidden rounded border border-white/10 text-left disabled:opacity-30"><img src={photoThumbUrl(item.id)} alt="" className="h-16 w-full object-cover" /><span className="block truncate p-1 text-xs text-slate-300">{item.filename}</span></button>)}</div>{pickerPhotos.length === 0 && <p className="text-xs text-slate-400">No matching media in your media.</p>}<div className="flex items-center justify-between text-xs text-slate-400"><button disabled={pickerPage === 0} onClick={() => setPickerPage((page) => page - 1)} className={buttonClass}>Previous</button><span>{pickerPage + 1} / {Math.max(1, Math.ceil(pickerTotal / 24))}</span><button disabled={(pickerPage + 1) * 24 >= pickerTotal} onClick={() => setPickerPage((page) => page + 1)} className={buttonClass}>Next</button></div></>}</div>}
                {!isVideo && backgrounds.length > 1 && cues.length > 0 && <div aria-label="Lyric lines to place" className="space-y-1"><p className="text-xs text-slate-400">Drag a lyric line onto an image (from image 2) to start that image with the line.</p><div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">{cues.map((cue, line) => <span key={line} draggable onDragStart={(event) => { event.dataTransfer.setData(LINE_TYPE, String(line)); event.dataTransfer.effectAllowed = 'copy'; }} title={`Starts at ${cue.start.toFixed(1)}s`} className="cursor-grab rounded-full border border-white/15 px-2 py-0.5 text-xs text-slate-200 hover:border-brand-400">{cue.start.toFixed(1)}s · {cue.text.slice(0, 28)}</span>)}</div></div>}
                <p className="text-xs text-slate-400">{backgroundType === 'image' ? `Up to 50 images, shown in order for equal portions of the song.${song && backgrounds.length ? ` ${(song.duration / backgrounds.length).toFixed(1)} seconds each.` : ''}` : 'The chosen video loops to the song’s length.'}</p>
              </section>
              <LyricImageGenerator initiallyOpen={photo.filename === 'Blank canvas.png'} projectId={projectId} lyrics={plainLyricLines(lyrics).join('\n')} cues={valid ? cues : []} canvas={resolvedCanvas} disabled={busy || !project.loaded || !lyrics.trim()} onUse={(images, starts) => {
                pause(); setBackgrounds(images); setBackgroundType('image'); setJob(null);
                if (starts && starts.every((start, index) => start < duration && (index === 0 || start > starts[index - 1]))) { setStoryboardStarts(starts); setSlideTiming('storyboard'); }
                else { setStoryboardStarts([]); setSlideTiming('lyrics'); }
                setNotice('Generated images are now your slideshow backgrounds. Preview before export.');
              }} />
              {!lyrics.trim() && <p className="text-xs text-slate-400">Paste lyrics in Song & words before creating images from them.</p>}
              </>}
              {stage === 'song' && <>
              <div><label className="mb-2 block text-sm font-medium text-slate-200">1. Upload song<input aria-label="Upload song" type="file" accept="audio/*,video/mp4,.mp3,.wav,.m4a,.flac,.ogg,.aac,.mp4" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} className="mt-2 block w-full text-xs text-slate-400" /></label><p className="text-xs text-slate-400">{song ? song.name : isVideo ? 'Or keep the background video’s audio with imported/manual timings.' : 'Upload a song, or drop one anywhere here, to turn this photo into a lyrical video.'}</p></div>
              <label className="block text-sm text-slate-200">2. Paste lyrics<textarea aria-label="Song lyrics" value={lyrics} onFocus={() => { if (cues.length) setUndoLyrics({ lyrics, cues }); }} onChange={(event) => { changeLyrics(event.target.value); }} maxLength={30000} rows={5} placeholder="One lyric line per line" className={`${inputClass} mt-2 resize-y`} /></label>
              <label className="cursor-pointer text-xs text-slate-400">Or import an LRC or SRT file (words with timings)<input aria-label="Import LRC or SRT" type="file" accept=".lrc,.srt,.txt" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => { setLyrics(text); setCues(buildLyricTimeline(text, duration)); setError(null); }).catch((problem) => setError(problem.message)); event.target.value = ''; }} /></label>
              <label className="block text-xs text-slate-400">Song language<KanaaSelect aria-label="Song language" value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-1"><option value="">Detect automatically</option><option value="ta">Tamil</option><option value="en">English</option><option value="hi">Hindi</option><option value="te">Telugu</option><option value="ml">Malayalam</option><option value="kn">Kannada</option><option value="es">Spanish</option></KanaaSelect></label>
              {undoLyrics && undoLyrics.cues !== cues && <button onClick={() => { setLyrics(undoLyrics.lyrics); setCues(undoLyrics.cues); setUndoLyrics(null); setNotice('Lyrics and timings restored.'); }} className={buttonClass}>Undo lyric changes</button>}
              <button onClick={() => { void start('sync'); }} disabled={!song || !lyrics.trim()} className="theme-action-brand flex w-full items-center justify-center gap-2 rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-3 text-sm text-brand-100"><Sparkles className="h-4 w-4" />Auto-sync lyrics</button>
              <p className="text-xs text-slate-400">{!song ? 'Add a song to sync.' : !lyrics.trim() ? 'Paste the words to sync.' : 'Sync runs locally. First use may download a speech model. Sung vocals can need timing corrections.'}</p>
              <div className="flex flex-wrap items-center gap-2"><button onClick={() => { try { setCues(buildLyricTimeline(lyrics, duration)); setNotice('Manual timings created. Adjust or auto-sync them before export.'); setError(null); } catch (problem) { setError((problem as Error).message); } }} className={buttonClass}>Build manual timeline</button></div>
              </>}
              {stage === 'style' && <>
              <section className="space-y-2"><h3 className="text-sm font-medium text-slate-200">Title-inspired looks</h3><div className="grid grid-cols-2 gap-2">{LYRIC_PRESETS.map((preset) => <button key={preset.id} type="button" className={`${buttonClass} min-h-14 text-left`} style={{ fontFamily: LYRIC_FONTS.find((item) => item.id === preset.font)?.family }} onClick={() => { setLyricFont(preset.font); setLyricStyle(preset.style); setColor(preset.color); setLyricBandColor(preset.band); setLyricAnimation(preset.animation); setPlacement(preset.placement); }}>{preset.label}<span className="mt-1 block text-[10px] font-normal text-slate-400">{preset.style} · {preset.animation}</span></button>)}</div></section>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">Position pattern<KanaaSelect aria-label="Lyric position pattern" value={placementMode} onChange={(event) => setPlacementMode(event.target.value as PlacementMode)} className="mt-1"><option value="alternate">Alternate top / bottom</option><option value="fixed">Fixed position</option><option value="per-line">Choose per line</option></KanaaSelect></label><label className="text-xs text-slate-400">Default position<KanaaSelect aria-label="Lyric position" value={placement} onChange={(event) => setPlacement(event.target.value as typeof placement)} className="mt-1"><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></KanaaSelect></label></div>
              <label className="block text-xs text-slate-400">Alignment<KanaaSelect aria-label="Lyric alignment" value={lyricAlign} onChange={(event) => setLyricAlign(event.target.value as LyricAlign)} className="mt-1"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></KanaaSelect></label>
              <label className="block text-xs text-slate-400">Font<KanaaSelect aria-label="Lyric font" value={lyricFont} onChange={(event) => setLyricFont(event.target.value as LyricFont)} className="mt-1" style={{ fontFamily: lyricFontFamily }}>{LYRIC_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}</KanaaSelect></label>
              <div className="flex items-center gap-3"><label className="text-xs text-slate-400">Text color<input aria-label="Lyric color" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="mt-1 block h-9 w-12" /></label><label className="flex-1 text-xs text-slate-400">Text size: {fontSize}<input aria-label="Lyric size" type="range" min={20} max={100} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} className="mt-2 w-full accent-brand-400" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">Image animation<KanaaSelect aria-label="Image animation" disabled={backgroundType === 'video'} value={imageAnimation} onChange={(event) => setImageAnimation(event.target.value as typeof imageAnimation)} className="mt-1"><option value="3d">3D camera glide</option><option value="ken-burns">Ken Burns (varied)</option><option value="zoom-in">Slow zoom in</option><option value="pan-left">Pan left</option><option value="none">None</option></KanaaSelect></label><label className="text-xs text-slate-400">Lyric animation<KanaaSelect aria-label="Lyric animation" value={lyricAnimation} onChange={(event) => setLyricAnimation(event.target.value as LyricAnimation)} className="mt-1"><option value="none">None</option><option value="fade">Fade</option><option value="slide-up">Slide up</option><option value="pop">Pop</option><option value="cinematic">Cinematic 3D</option></KanaaSelect></label></div>
              {imageAnimation === '3d' && backgroundType !== 'video' && <><label className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={inScene} onChange={(event) => setInScene(event.target.checked)} className="mt-0.5"/><span>Lyrics inside the scene<span className="block text-slate-400">People, trees and pillars in each picture pass in front of the words.</span></span></label>
                <p className="text-xs text-slate-400">Each picture becomes a short 3D video: the camera glides in and near things move more than far ones. Made once on export (a few seconds a picture); the preview here shows a plain zoom.</p></>}
              {making3d && <p className="text-xs text-violet-300" role="status">{making3d}</p>}
              {lyricAnimation === 'cinematic' && <p className="text-xs text-slate-400">Each line has solid 3D letters, leans back a little and flies in from the distance. It exports through the Video Editor’s renderer, so it matches there exactly.</p>}
              <label className="text-xs text-slate-400">Text style<KanaaSelect aria-label="Lyric style" value={lyricStyle} onChange={(event) => setLyricStyle(event.target.value as LyricStyle)} className="mt-1"><option value="band">Band (most readable)</option><option value="shadow">Soft shadow</option><option value="outline">Outline</option></KanaaSelect></label>
              {lyricStyle === 'band' && <label className="block text-xs text-slate-400">Band colour<input aria-label="Lyric band color" type="color" value={lyricBandColor} onChange={(event) => setLyricBandColor(event.target.value)} className="mt-1 block h-9 w-12" /></label>}
              <p className="text-xs text-slate-400">Background fills the frame. Video backgrounds loop to the song’s length.</p>
              </>}
              {stage === 'timing' && <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">Image changes<KanaaSelect aria-label="Image timing" disabled={backgroundType === 'video'} value={slideTiming} onChange={(event) => setSlideTiming(event.target.value as SlideTiming)} className="mt-1"><option value="lyrics">Follow lyrics</option><option value="beats">On the beat</option><option value="even">Evenly</option>{storyboardStarts.length > 0 && <option value="storyboard">Saved storyboard</option>}</KanaaSelect></label>
                <label className="flex items-end gap-2 pb-2 text-sm text-slate-300"><input type="checkbox" checked={crossfade} disabled={backgroundType === 'video'} onChange={(event) => setCrossfade(event.target.checked)} className="accent-brand-400" />Crossfade images</label>
              </div>
              {slideTiming === 'beats' && beats?.songId === song?.id && Boolean(beats?.bpm) && <p className="text-xs text-slate-400">Detected about {Math.round(beats!.bpm)} BPM.</p>}
              {!cues.length && <div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">Sync the lyrics or build a manual timeline in Song & words to edit line timing.</div>}
              {cues.length > 0 && <LyricSyncFix cues={cues} duration={duration} position={position} onSeek={seek} onChange={(next, note) => { setUndoLyrics({ lyrics, cues }); setCues(next); setNotice(note); }} />}
              {cues.length > 0 && <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-slate-200">3. Review line timings</h3><div className="flex gap-2 text-xs"><button onClick={() => downloadText(`${songBaseName}.lrc`, cuesToLrc(cues))} className="text-brand-300 hover:underline">Save LRC</button><button onClick={() => downloadText(`${songBaseName}.srt`, cuesToSrt(cues))} className="text-brand-300 hover:underline">Save SRT</button></div></div><div className="space-y-3">{cues.map((cue, index) => <div key={index} className="rounded-xl border border-white/10 p-2"><div className="mb-2 flex items-center justify-between text-xs text-slate-400"><button onClick={() => { seek(cue.start); if (window.innerWidth < 1024) stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} className="text-brand-300">Line {index + 1} · Preview</button><span>{positionForCue(cue, index)}</span>{cue.review && <span>Check timing</span>}<button aria-label={`Remove lyric line ${index + 1}`} onClick={() => setCues((previous) => previous.filter((_, current) => current !== index))}>Remove</button></div><input aria-label={`Lyric line ${index + 1}`} value={cue.text} maxLength={500} onChange={(event) => editCue(index, { text: event.target.value })} className={inputClass} /><label className="mt-2 block text-xs text-slate-400">Line position<KanaaSelect aria-label={`Line ${index + 1} position`} value={cue.position ?? ''} onChange={(event) => editCue(index, { position: (event.target.value || undefined) as LyricCue['position'] })} className="mt-1"><option value="">Automatic ({positionForCue({ ...cue, position: undefined }, index)})</option><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></KanaaSelect></label><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-slate-400">Start<input aria-label={`Line ${index + 1} start`} type="number" min={0} max={duration} step={0.05} value={cue.start} onChange={(event) => editCue(index, { start: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label><label className="text-xs text-slate-400">End<input aria-label={`Line ${index + 1} end`} type="number" min={cue.start} max={duration} step={0.05} value={cue.end} onChange={(event) => editCue(index, { end: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label></div></div>)}</div></div>}
              </>}
              {stage === 'export' && <section className="space-y-4" aria-label="Finish in Video Editor">
                <h3 className="text-sm font-medium text-slate-200">Finish in Video Editor</h3><p className="text-xs text-slate-400">Kanaa will create an editable final project with a 3-second opening card, every timed lyric line, and a 3-second closing credits card. Edit those cards and export from the Video Editor.</p>
                <div className="space-y-2 rounded-xl border border-white/10 p-3 text-xs text-slate-300"><p>{firstBackground ? '✓ Background ready' : '○ Choose a background'}</p><p>{isVideo || song ? '✓ Audio source ready' : '○ Add a song'}</p><p>{valid && cues.length ? `✓ ${cues.length} timed lyric lines` : '○ Sync and review lyric timing'}</p><p>{resolvedCanvas === 'portrait' ? '9:16 portrait' : resolvedCanvas === 'square' ? '1:1 square' : '16:9 landscape'}{canvas === 'auto' ? ' · matched to media' : ''} · {quality} · MP4</p></div>
                {(!firstBackground || !song || !valid || !cues.length) && <p className="text-xs text-amber-200">Complete the missing items above before continuing.</p>}
                <button onClick={() => { void continueInEditor(); }} disabled={busy || !valid || !cues.length || !firstBackground || !song} className="theme-action-brand flex w-full items-center justify-center gap-2 rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-3 text-sm text-brand-100 disabled:opacity-40"><Music className="h-4 w-4" />{handingOff ? 'Preparing final edit…' : 'Continue in Video Editor'}</button>
              </section>}
            </fieldset>
            {(() => {
              const index = LYRIC_STAGES.findIndex((item) => item.id === stage);
              const previous = LYRIC_STAGES[index - 1], next = LYRIC_STAGES[index + 1];
              const why = stage === 'song' ? (!song ? 'Add a song first.' : 'Paste the words first.') : stage === 'background' ? 'Choose a picture or a video first.' : stage === 'timing' ? (cues.length ? 'Fix the highlighted line times first.' : 'Sync the lyrics or build a timeline first.') : '';
              return <div className="lyric-step-nav sticky bottom-0 flex items-center gap-2 border-t border-white/10 bg-slate-950 p-3">
                {previous ? <button type="button" onClick={() => setStage(previous.id)} className={buttonClass}>← {previous.label}</button> : <span/>}
                <span className="flex-1 text-center text-xs text-slate-400">{project.saveFailed ? 'Could not save' : project.saving ? 'Saving…' : `✓ Saved · step ${index + 1} of ${LYRIC_STAGES.length}`}</span>
                {next && <button type="button" disabled={!done[stage] && stage !== 'style'} title={!done[stage] && stage !== 'style' ? why : undefined} onClick={() => setStage(next.id)} className="theme-action-brand rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-2 text-sm text-brand-100 disabled:opacity-40">{next.label} →</button>}
              </div>;
            })()}
          </aside>
        </div>
        <footer className="shrink-0 space-y-2 border-t border-white/10 p-3">
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}{notice && <p role="status" className="text-xs text-slate-300">{notice}</p>}
          {busy && <div role="status"><p className="mb-1 text-xs text-slate-300">{uploading ? 'Uploading song…' : starting ? 'Starting…' : `${job?.status?.phase || (job?.kind === 'sync' ? 'Syncing lyrics…' : 'Exporting lyrical video…')} ${job?.status?.progress ?? 0}%`}</p><progress aria-label="Lyrical creation progress" max={100} value={job?.status?.progress ?? 0} className="h-2 w-full accent-brand-400" /></div>}
          {!valid && cues.length > 0 && <p className="text-xs text-rose-300">Check that lines have text and their times are ordered, non-overlapping, and inside the song.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-400">Lyrics are burned into a new MP4 copy in Exports. {project.saveFailed ? 'Could not save this project.' : project.saving ? 'Saving…' : 'All changes saved.'}</span><div className="flex gap-2">{job && !job.status?.done && <button onClick={() => { void cancelRenderJob(job.id).catch(() => {}); }} className={buttonClass}>Cancel</button>}{outputId != null && <button onClick={() => { onOpenOutput?.(outputId); onClose(); }} className={buttonClass}>Open lyrical video</button>}{stage !== 'export' && <button onClick={() => setStage('export')} className="theme-action-brand rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-2 text-sm text-brand-100">Review export</button>}</div></div>
        </footer>
      </div>
    </div>
  </>, document.body);
}
