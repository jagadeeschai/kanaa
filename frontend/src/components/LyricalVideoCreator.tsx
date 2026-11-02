import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music, Sparkles, X } from 'lucide-react';
import { cancelRenderJob, getSongBeats, getJobStatus, getPhoto, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, startLyricSync, startVideoExport, uploadVideoAudio, videoAudioUrl } from '../api/client';
import type { JobStatusResponse, Photo } from '../types/photo';
import { buildLyricTimeline, cuesToLrc, cuesToSrt, hasLyricTimings, plainLyricLines, reconcileLyricCues, validateLyricCues, type LyricCue } from '../utils/lyrics';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useVideoProject } from '../hooks/useVideoProject';
import ImportArea from './ImportArea';
import LyricImageGenerator from './LyricImageGenerator';
import { computeSlideStarts, crossfadeSeconds, slideIndexAt, slideTransform, type ImageAnimation, type SlideTiming } from '../utils/slides';

// Same bundled fonts as the export, loaded in index.css, so the preview matches it.
const LYRIC_FONT_STACK = "'Noto Sans', 'Noto Sans Tamil', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Gurmukhi', 'Noto Sans Gujarati', 'Noto Sans Telugu', 'Noto Sans Kannada', 'Noto Sans Malayalam', sans-serif";
// Lyric size scales with frame width, so wide frames need a smaller value to read the same.
const DEFAULT_LYRIC_SIZE = 44;
const LANDSCAPE_LYRIC_SIZE = 28;
const inputClass = 'theme-control w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100';
const buttonClass = 'theme-control rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 disabled:opacity-40';
type Job = { id: string; kind: 'sync' | 'export'; status: JobStatusResponse | null };
type LyricRecipe = {
  version: 1;
  clips: { photo_id: number }[];
  song: { id: string; name: string; duration: number } | null;
  lyrics: string;
  cues: LyricCue[];
  language: string;
  canvas: 'portrait' | 'square' | 'landscape';
  color: string;
  fontSize: number;
  placement: 'top' | 'center' | 'bottom';
  imageAnimation: ImageAnimation;
  lyricAnimation: 'none' | 'fade' | 'slide-up';
  slideTiming?: SlideTiming;
  storyboardStarts?: number[];
  crossfade?: boolean;
  quality?: '720p' | '1080p' | '4k';
  lyricStyle?: LyricStyle;
};
type LyricStyle = 'outline' | 'shadow' | 'band';

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

export default function LyricalVideoCreator({ photo, projectId, projectName, onClose, onOpenOutput }: { photo: Photo; projectId: number; projectName: string; onClose: () => void; onOpenOutput?: (id: number) => void }) {
  const [backgrounds, setBackgrounds] = useState<Photo[]>([photo]);
  const [backgroundType, setBackgroundType] = useState(photo.media_type === 'video' ? 'video' : 'image');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPhotos, setPickerPhotos] = useState<Photo[]>([]);
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [imageAnimation, setImageAnimation] = useState<ImageAnimation>('ken-burns');
  const [slideTiming, setSlideTiming] = useState<SlideTiming>('lyrics');
  const [crossfade, setCrossfade] = useState(true);
  const [quality, setQuality] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [lyricStyle, setLyricStyle] = useState<LyricStyle>('band');
  const [storyboardStarts, setStoryboardStarts] = useState<number[]>([]);
  const [beats, setBeats] = useState<{ songId: string; times: number[]; bpm: number } | null>(null);
  const [lyricAnimation, setLyricAnimation] = useState<'none' | 'fade' | 'slide-up'>('none');
  const [lyrics, setLyrics] = useState('');
  const [cues, setCues] = useState<LyricCue[]>([]);
  const [undoLyrics, setUndoLyrics] = useState<{ lyrics: string; cues: LyricCue[] } | null>(null);
  const [song, setSong] = useState<{ id: string; duration: number; name: string; url: string } | null>(null);
  const [language, setLanguage] = useState('');
  const [canvas, setCanvas] = useState<'portrait' | 'square' | 'landscape'>('portrait');
  const [color, setColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState(DEFAULT_LYRIC_SIZE);
  const [placement, setPlacement] = useState<'top' | 'center' | 'bottom'>('bottom');
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 500 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lockRef = useRef(false);
  const closeRef = useRef(() => {});
  useFocusTrap(dialogRef, true);
  const firstBackground = backgrounds[0];
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
  const busy = starting || uploading || Boolean(job && !job.status?.done);
  const valid = validateLyricCues(cues, duration);
  const ratio = canvas === 'portrait' ? 9 / 16 : canvas === 'square' ? 1 : 16 / 9;
  const previewWidth = Math.min(stageSize.width - 24, (stageSize.height - 24) * ratio);
  const currentCue = cues.find((cue) => position >= cue.start && position < cue.end);
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
    lyrics, cues, language, canvas, color, fontSize, placement, imageAnimation, lyricAnimation, slideTiming, storyboardStarts, crossfade, quality, lyricStyle,
  } : null, async (recipe) => {
    setLyrics(recipe.lyrics ?? ''); setCues(recipe.cues ?? []); setLanguage(recipe.language ?? ''); setCanvas(recipe.canvas ?? 'portrait'); setColor(recipe.color ?? '#ffffff');
    setFontSize(recipe.fontSize ?? 44); setPlacement(recipe.placement ?? 'bottom'); setImageAnimation(recipe.imageAnimation ?? 'none'); setLyricAnimation(recipe.lyricAnimation ?? 'none');
    setSlideTiming(recipe.slideTiming ?? 'even'); setStoryboardStarts(recipe.storyboardStarts ?? []); setCrossfade(recipe.crossfade ?? false); setQuality(recipe.quality ?? '720p'); setLyricStyle(recipe.lyricStyle ?? 'outline');
    if (recipe.song) setSong({ ...recipe.song, url: videoAudioUrl(recipe.song.id) });
    await Promise.all((recipe.clips ?? []).map((clip) => getPhoto(clip.photo_id).catch(() => null))).then((photos) => {
      const available = photos.filter((item): item is Photo => item !== null);
      if (available.length) { setBackgrounds(available); setBackgroundType(available[0].media_type === 'video' ? 'video' : 'image'); }
    });
    setNotice('Restored your saved project.');
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
  const start = async (kind: 'sync' | 'export') => {
    if (lockRef.current || busy) return;
    if (kind === 'sync' && (!song || !plainLyricLines(lyrics).length)) { setError('Upload a song and paste its lyrics first.'); return; }
    if (kind === 'sync' && plainLyricLines(lyrics).some((line) => line.length > 500)) { setError('Keep each lyric line under 500 characters.'); return; }
    if (kind === 'export' && (!valid || !firstBackground || (!isVideo && !song))) { setError('Check the lyric timeline before exporting.'); return; }
    lockRef.current = true; setStarting(true); setError(null); setNotice(null); pause();
    try {
      const result = kind === 'sync'
        ? await startLyricSync(song!.id, plainLyricLines(lyrics).join('\n'), language || null)
        : await startVideoExport(firstBackground.id, { background_photo_ids: isVideo ? [] : backgrounds.map((item) => item.id), image_animation: imageAnimation, slide_starts: isVideo ? [] : slideStarts, transition: crossfade ? 'crossfade' : 'none', quality, lyric_style: lyricStyle, lyric_animation: lyricAnimation, trim_start: 0, trim_end: duration, rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1, volume: 1, mute: false, audio_asset_id: song?.id, canvas, lyrics: cues.map(({ start, end, text }) => ({ start, end, text })), lyric_color: color, lyric_size: fontSize, lyric_position: placement });
      setJob({ id: result.job_id, kind, status: null });
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not start the job.'); }
    finally { lockRef.current = false; setStarting(false); }
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

  return createPortal(<>
    <div className="theme-overlay fixed inset-0 z-[110] bg-black/70 sm:p-4">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Lyrical video creator" className="theme-modal flex h-full flex-col overflow-hidden border border-white/10 bg-slate-950 outline-none sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><div><h2 className="text-base font-semibold text-slate-100">{projectName}</h2><p className="text-xs text-slate-400">Song → Auto-sync → Preview → Export</p></div><button onClick={close} aria-label="Close lyrical creator" className={buttonClass}><span className="flex items-center gap-2"><span className="hidden sm:inline">Back to studio</span><X className="h-4 w-4" /></span></button></header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="sticky top-0 z-10 flex shrink-0 flex-col bg-white lg:static lg:min-w-0 lg:flex-1">
            <div ref={stageRef} className="flex h-[28dvh] min-h-40 items-center justify-center overflow-hidden bg-black lg:h-auto lg:flex-1">
              <div className="relative overflow-hidden bg-black" style={{ width: Math.max(1, previewWidth), aspectRatio: String(ratio) }}>
                {isVideo && firstBackground ? <video key={firstBackground.id} ref={videoRef} src={photoVideoUrl(firstBackground.id)} poster={photoThumbUrl(firstBackground.id)} preload="metadata" loop={Boolean(song)} muted={Boolean(song)} className="h-full w-full object-cover" aria-label="Lyrical video preview" onTimeUpdate={(event) => { if (!song) setPosition(event.currentTarget.currentTime); }} onEnded={() => { if (!song) setPlaying(false); }} /> : activeBackground ? <>
                  {fadeProgress < 1 && <img src={photoImageUrl(backgrounds[slideIndex - 1].id)} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: slideTransform(imageAnimation, slideIndex - 1, slideStarts, duration, fadeSeconds, position) }} />}
                  <img src={photoImageUrl(activeBackground.id)} alt={activeBackground.filename} className="absolute inset-0 h-full w-full object-cover" style={{ opacity: fadeProgress, transform: slideTransform(imageAnimation, slideIndex, slideStarts, duration, fadeSeconds, position) }} />
                </> : <p className="p-4 text-center text-sm text-white">Choose images or a video below</p>}
                {currentCue && <div className="pointer-events-none absolute text-center font-bold" style={{ left: '5.5%', right: '5.5%', color, fontFamily: LYRIC_FONT_STACK, fontSize: fontSize * previewWidth / 720, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', opacity: lyricAnimation === 'none' ? 1 : Math.min(1, Math.max(0, (position - currentCue.start) / Math.min(.25, (currentCue.end - currentCue.start) / 3)), lyricAnimation === 'fade' ? Math.max(0, (currentCue.end - position) / Math.min(.25, (currentCue.end - currentCue.start) / 3)) : 1), translate: lyricAnimation === 'slide-up' ? `0 ${Math.max(0, 1 - (position - currentCue.start) / Math.min(.25, (currentCue.end - currentCue.start) / 3)) * previewWidth / ratio * .04}px` : undefined, ...LYRIC_STYLE_CSS[lyricStyle], ...(placement === 'top' ? { top: '8%' } : placement === 'bottom' ? { bottom: '8%' } : { top: '50%', transform: 'translateY(-50%)' }) }}>{lyricStyle === 'band' ? <span style={{ background: 'rgba(0,0,0,.56)', padding: `${.15 * fontSize * previewWidth / 720}px ${.3 * fontSize * previewWidth / 720}px`, WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }}>{currentCue.text}</span> : currentCue.text}</div>}
              </div>
            </div>
            {song && <audio ref={audioRef} src={song.url} onError={() => { setSong(null); setNotice('The saved song is no longer available. Upload it again.'); }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onEnded={() => pause()} />}
            <div className="space-y-2 border-t border-white/10 p-3"><input aria-label="Lyrical video playhead" type="range" min={0} max={duration || 1} step={0.05} value={Math.min(position, duration || 1)} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-brand-400" /><div className="flex items-center justify-between"><button onClick={() => { void play(); }} className={buttonClass}>{playing ? 'Pause lyrical preview' : 'Play lyrical preview'}</button><span className="text-xs text-slate-400">{position.toFixed(1)} / {duration.toFixed(1)} s</span></div></div>
          </div>
          <aside aria-label="Lyrical video settings" className="space-y-4 border-t border-white/10 p-4 lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <fieldset disabled={busy || !project.loaded} className="space-y-4 disabled:opacity-60">
              <section aria-label="Background selection" className="space-y-3 rounded-xl border border-white/10 p-3">
                <h3 className="text-sm font-medium text-slate-200">Background</h3>
                <div className="flex gap-2">{(['image', 'video'] as const).map((type) => <button key={type} aria-pressed={backgroundType === type} onClick={() => { pause(); setBackgroundType(type); setPickerOpen(true); setPickerPage(0); setPickerSearch(''); setPickerPhotos([]); setJob(null); if (backgrounds[0]?.media_type !== type) { setBackgrounds([]); setPosition(0); } }} className={`${buttonClass} ${backgroundType === type ? 'border-brand-400 text-brand-300' : ''}`}>{type === 'image' ? 'Images / slideshow' : 'Video'}</button>)}</div>
                {backgrounds.map((item, index) => <div key={`${item.id}-${index}`} className="flex items-center gap-2 text-xs text-slate-300"><img src={photoThumbUrl(item.id)} alt="" className="h-10 w-10 rounded object-cover" /><span className="min-w-0 flex-1 truncate">{index + 1}. {item.filename}</span>{!isVideo && <><button aria-label={`Move image ${index + 1} earlier`} disabled={index === 0} onClick={() => { pause(); setBackgrounds((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); }} className={buttonClass}>↑</button><button aria-label={`Remove image ${index + 1}`} onClick={() => { pause(); setBackgrounds((items) => items.filter((_, i) => i !== index)); }} className={buttonClass}>×</button></>}</div>)}
                <button onClick={() => { setPickerOpen(!pickerOpen); }} className={buttonClass}>{pickerOpen ? 'Close media picker' : backgroundType === 'image' ? 'Add images from media' : 'Choose video from media'}</button>
                {pickerOpen && <div className="space-y-2"><ImportArea compact videoOnly={backgroundType === 'video'} onImported={(items) => { pause(); const matching = items.filter((item) => item.media_type === backgroundType); if (!matching.length) { setNotice(`Imported media. Switch to ${items[0]?.media_type === 'video' ? 'Video' : 'Images'} to use it.`); return; } setBackgrounds((previous) => backgroundType === 'video' ? matching.slice(0, 1) : [...previous, ...matching].slice(0, 50)); setPickerOpen(false); setJob(null); }} /><input aria-label="Search background media" placeholder="Search your media" value={pickerSearch} onChange={(event) => { setPickerSearch(event.target.value); setPickerPage(0); }} className={inputClass} />{pickerLoading ? <p role="status" className="text-xs text-slate-400">Loading media…</p> : <><div className="grid grid-cols-3 gap-2">{pickerPhotos.map((item) => <button key={item.id} aria-label={`Choose ${item.filename}`} disabled={backgroundType === 'image' && (backgrounds.some((selected) => selected.id === item.id) || backgrounds.length >= 50)} onClick={() => { pause(); setJob(null); setPosition(0); if (backgroundType === 'video') { setBackgrounds([item]); setPickerOpen(false); } else setBackgrounds((items) => [...items, item]); }} className="overflow-hidden rounded border border-white/10 text-left disabled:opacity-30"><img src={photoThumbUrl(item.id)} alt="" className="h-16 w-full object-cover" /><span className="block truncate p-1 text-xs text-slate-300">{item.filename}</span></button>)}</div>{pickerPhotos.length === 0 && <p className="text-xs text-slate-400">No matching media in your media.</p>}<div className="flex items-center justify-between text-xs text-slate-400"><button disabled={pickerPage === 0} onClick={() => setPickerPage((page) => page - 1)} className={buttonClass}>Previous</button><span>{pickerPage + 1} / {Math.max(1, Math.ceil(pickerTotal / 24))}</span><button disabled={(pickerPage + 1) * 24 >= pickerTotal} onClick={() => setPickerPage((page) => page + 1)} className={buttonClass}>Next</button></div></>}</div>}
                <p className="text-xs text-slate-400">{backgroundType === 'image' ? `Up to 50 images, shown in order for equal portions of the song.${song && backgrounds.length ? ` ${(song.duration / backgrounds.length).toFixed(1)} seconds each.` : ''}` : 'The chosen video loops to the song’s length.'}</p>
              </section>

              <div><label className="mb-2 block text-sm font-medium text-slate-200">1. Upload song<input aria-label="Upload song" type="file" accept="audio/*,video/mp4,.mp3,.wav,.m4a,.flac,.ogg,.aac,.mp4" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} className="mt-2 block w-full text-xs text-slate-400" /></label><p className="text-xs text-slate-400">{song ? song.name : isVideo ? 'Or keep the background video’s audio with imported/manual timings.' : 'Upload a song to turn this photo into a lyrical video.'}</p></div>
              <label className="block text-sm text-slate-200">2. Paste lyrics<textarea aria-label="Song lyrics" value={lyrics} onFocus={() => { if (cues.length) setUndoLyrics({ lyrics, cues }); }} onChange={(event) => { changeLyrics(event.target.value); }} maxLength={30000} rows={5} placeholder="One lyric line per line" className={`${inputClass} mt-2 resize-y`} /></label>
              <LyricImageGenerator initiallyOpen={photo.filename === 'Blank canvas.png'} projectId={projectId} lyrics={plainLyricLines(lyrics).join('\n')} cues={valid ? cues : []} canvas={canvas} disabled={busy || !project.loaded} onUse={(images, starts) => {
                pause(); setBackgrounds(images); setBackgroundType('image'); setJob(null);
                if (starts && starts.every((start, index) => start < duration && (index === 0 || start > starts[index - 1]))) { setStoryboardStarts(starts); setSlideTiming('storyboard'); }
                else { setStoryboardStarts([]); setSlideTiming('lyrics'); }
                setNotice('Generated images are now your slideshow backgrounds. Preview before export.');
              }} />
              <label className="block text-xs text-slate-400">Song language<select aria-label="Song language" value={language} onChange={(event) => setLanguage(event.target.value)} className={`${inputClass} mt-1`}><option value="">Detect automatically</option><option value="ta">Tamil</option><option value="en">English</option><option value="hi">Hindi</option><option value="te">Telugu</option><option value="ml">Malayalam</option><option value="kn">Kannada</option><option value="es">Spanish</option></select></label>
              {undoLyrics && undoLyrics.cues !== cues && <button onClick={() => { setLyrics(undoLyrics.lyrics); setCues(undoLyrics.cues); setUndoLyrics(null); setNotice('Lyrics and timings restored.'); }} className={buttonClass}>Undo lyric changes</button>}
              <button onClick={() => { void start('sync'); }} disabled={!song || !lyrics.trim()} className="theme-action-brand flex w-full items-center justify-center gap-2 rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-3 text-sm text-brand-100"><Sparkles className="h-4 w-4" />Auto-sync lyrics</button>
              <p className="text-xs text-slate-400">Sync runs locally. First use may download a speech model. Sung vocals can need timing corrections.</p>
              <div className="flex flex-wrap items-center gap-2"><button onClick={() => { try { setCues(buildLyricTimeline(lyrics, duration)); setNotice('Manual timings created. Adjust or auto-sync them before export.'); setError(null); } catch (problem) { setError((problem as Error).message); } }} className={buttonClass}>Build manual timeline</button><label className="cursor-pointer text-xs text-slate-400">Import LRC or SRT<input aria-label="Import LRC or SRT" type="file" accept=".lrc,.srt,.txt" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => { setLyrics(text); setCues(buildLyricTimeline(text, duration)); setError(null); }).catch((problem) => setError(problem.message)); event.target.value = ''; }} /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">Format<select aria-label="Lyrical video format" value={canvas} onChange={(event) => { const next = event.target.value as typeof canvas; setCanvas(next); setFontSize(next === 'landscape' ? LANDSCAPE_LYRIC_SIZE : DEFAULT_LYRIC_SIZE); }} className={`${inputClass} mt-1`}><option value="portrait">Portrait 9:16</option><option value="square">Square 1:1</option><option value="landscape">Landscape 16:9</option></select></label><label className="text-xs text-slate-400">Text position<select aria-label="Lyric position" value={placement} onChange={(event) => setPlacement(event.target.value as typeof placement)} className={`${inputClass} mt-1`}><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label></div>
              <div className="flex items-center gap-3"><label className="text-xs text-slate-400">Text color<input aria-label="Lyric color" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="mt-1 block h-9 w-12" /></label><label className="flex-1 text-xs text-slate-400">Text size: {fontSize}<input aria-label="Lyric size" type="range" min={20} max={100} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} className="mt-2 w-full accent-brand-400" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">Image animation<select aria-label="Image animation" disabled={backgroundType === 'video'} value={imageAnimation} onChange={(event) => setImageAnimation(event.target.value as typeof imageAnimation)} className={`${inputClass} mt-1`}><option value="ken-burns">Ken Burns (varied)</option><option value="zoom-in">Slow zoom in</option><option value="pan-left">Pan left</option><option value="none">None</option></select></label><label className="text-xs text-slate-400">Lyric animation<select aria-label="Lyric animation" value={lyricAnimation} onChange={(event) => setLyricAnimation(event.target.value as typeof lyricAnimation)} className={`${inputClass} mt-1`}><option value="none">None</option><option value="fade">Fade</option><option value="slide-up">Slide up</option></select></label></div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">Image changes<select aria-label="Image timing" disabled={backgroundType === 'video'} value={slideTiming} onChange={(event) => setSlideTiming(event.target.value as SlideTiming)} className={`${inputClass} mt-1`}><option value="lyrics">Follow lyrics</option><option value="beats">On the beat</option><option value="even">Evenly</option>{storyboardStarts.length > 0 && <option value="storyboard">Saved storyboard</option>}</select></label>
                <label className="text-xs text-slate-400">Text style<select aria-label="Lyric style" value={lyricStyle} onChange={(event) => setLyricStyle(event.target.value as LyricStyle)} className={`${inputClass} mt-1`}><option value="band">Band (most readable)</option><option value="shadow">Soft shadow</option><option value="outline">Outline</option></select></label>
                <label className="text-xs text-slate-400">Quality<select aria-label="Export quality" value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)} className={`${inputClass} mt-1`}><option value="1080p">1080p</option><option value="4k">4K (much slower)</option><option value="720p">720p (faster)</option></select></label>
                <label className="flex items-end gap-2 pb-2 text-sm text-slate-300"><input type="checkbox" checked={crossfade} disabled={backgroundType === 'video'} onChange={(event) => setCrossfade(event.target.checked)} className="accent-brand-400" />Crossfade images</label>
              </div>
              {slideTiming === 'beats' && beats?.songId === song?.id && Boolean(beats?.bpm) && <p className="text-xs text-slate-400">Detected about {Math.round(beats!.bpm)} BPM.</p>}
              <p className="text-xs text-slate-400">Background fills the frame. Video backgrounds loop to the song’s length.</p>
              {cues.length > 0 && <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-slate-200">3. Review line timings</h3><div className="flex gap-2 text-xs"><button onClick={() => downloadText(`${songBaseName}.lrc`, cuesToLrc(cues))} className="text-brand-300 hover:underline">Save LRC</button><button onClick={() => downloadText(`${songBaseName}.srt`, cuesToSrt(cues))} className="text-brand-300 hover:underline">Save SRT</button></div></div><div className="space-y-3">{cues.map((cue, index) => <div key={index} className="rounded-xl border border-white/10 p-2"><div className="mb-2 flex items-center justify-between text-xs text-slate-400"><button onClick={() => { seek(cue.start); if (window.innerWidth < 1024) stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} className="text-brand-300">Line {index + 1} · Preview</button>{cue.review && <span>Check timing</span>}<button aria-label={`Remove lyric line ${index + 1}`} onClick={() => setCues((previous) => previous.filter((_, current) => current !== index))}>Remove</button></div><input aria-label={`Lyric line ${index + 1}`} value={cue.text} maxLength={500} onChange={(event) => editCue(index, { text: event.target.value })} className={inputClass} /><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-slate-400">Start<input aria-label={`Line ${index + 1} start`} type="number" min={0} max={duration} step={0.05} value={cue.start} onChange={(event) => editCue(index, { start: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label><label className="text-xs text-slate-400">End<input aria-label={`Line ${index + 1} end`} type="number" min={cue.start} max={duration} step={0.05} value={cue.end} onChange={(event) => editCue(index, { end: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label></div></div>)}</div></div>}
            </fieldset>
          </aside>
        </div>
        <footer className="shrink-0 space-y-2 border-t border-white/10 p-3">
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}{notice && <p role="status" className="text-xs text-slate-300">{notice}</p>}
          {busy && <div role="status"><p className="mb-1 text-xs text-slate-300">{uploading ? 'Uploading song…' : starting ? 'Starting…' : `${job?.status?.phase || (job?.kind === 'sync' ? 'Syncing lyrics…' : 'Exporting lyrical video…')} ${job?.status?.progress ?? 0}%`}</p><progress aria-label="Lyrical creation progress" max={100} value={job?.status?.progress ?? 0} className="h-2 w-full accent-brand-400" /></div>}
          {!valid && cues.length > 0 && <p className="text-xs text-rose-300">Check that lines have text and their times are ordered, non-overlapping, and inside the song.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-400">Lyrics are burned into a new MP4 copy in Exports. {project.saveFailed ? 'Could not save this project.' : project.saving ? 'Saving…' : 'All changes saved.'}</span><div className="flex gap-2">{job && !job.status?.done && <button onClick={() => { void cancelRenderJob(job.id).catch(() => {}); }} className={buttonClass}>Cancel</button>}{outputId != null && <button onClick={() => { onOpenOutput?.(outputId); onClose(); }} className={buttonClass}>Open lyrical video</button>}<button onClick={() => { void start('export'); }} disabled={busy || !valid || !firstBackground || (!isVideo && !song)} className="theme-action-brand flex items-center gap-2 rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-2 text-sm text-brand-100 disabled:opacity-40"><Music className="h-4 w-4" />Export lyrical video</button></div></div>
        </footer>
      </div>
    </div>
  </>, document.body);
}
