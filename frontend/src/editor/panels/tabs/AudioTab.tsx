import { useState } from "react";
import { AudioLines,LoaderCircle,Music,Pause,Play,Plus,Search,X } from "lucide-react";
import { type Mood } from "../../../api/client";
import { mainLayer,timecode } from "../../../timeline/model";
import { removeEffects } from "../../../timeline/sfx";
import { useEditorPanel } from "../../state/EditorContext";
import type { EditorLeftRailBindings } from '../EditorLeftRail';
import NarratePanel from '../../NarratePanel';
import DocumentarySoundPanel from '../../DocumentarySoundPanel';
import LyricSectionsPanel from '../../LyricSectionsPanel';
import SectionLightsPanel from '../../SectionLightsPanel';
import { lyricLines } from '../../../timeline/song-sections';
import { t } from '../../../i18n';

type AudioPart = 'music' | 'lyrics' | 'voice' | 'sounds';
const PART_KEY = 'kanaa.audio-part';
const remembered = (): AudioPart => { try { const value = localStorage.getItem(PART_KEY); return value === 'lyrics' || value === 'voice' || value === 'sounds' ? value : 'music'; } catch { return 'music'; } };

export function AudioTabSection1() {
  const { leftTab, library, libraryFolder, musicSearch, musicMood, setMusicSearch, MOODS, setMusicMood, MOOD_LABELS, listening, draggableAs, listen, addingMusic, addLibraryTrack, addMusic, layout, soundEffects, timeline, sfxChoice, setSfxChoice, total, sfxBusy, addSoundEffects, change, sfxNote, beatBusy, cutClipsToBeat, beatNote } = useEditorPanel<EditorLeftRailBindings>('left');
  // Four parts, so the tab isn't one long list: music, lyric-video tools (only with lyrics), narration, and sound effects.
  const [chosen, setChosen] = useState<AudioPart>(remembered);
  const hasLyrics = Boolean(timeline && lyricLines(timeline).length >= 2);
  const tabs: { id: AudioPart; label: string }[] = [{ id: 'music', label: 'Music' }, ...(hasLyrics ? [{ id: 'lyrics' as const, label: 'Lyrics' }] : []), { id: 'voice', label: 'Voice' }, { id: 'sounds', label: 'Sounds' }];
  const part: AudioPart = chosen === 'lyrics' && !hasLyrics ? 'music' : chosen;
  const choose = (next: AudioPart) => { setChosen(next); try { localStorage.setItem(PART_KEY, next); } catch { /* Remembering is only a convenience. */ } };
  return (<>{leftTab === 'audio' && <>
          <div className="ed-tabs ed-tabs-compact" role="tablist" aria-label={t('Sound tools')} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)`}}>{tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={part === tab.id} onClick={() => choose(tab.id)}>{t(tab.label)}</button>)}</div>
          {part === 'music' && <>
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
          {!layout.simple && <section className="ed-add" aria-label="Cut to the beat"><h3 className="ed-sub">Cut to the beat</h3><p className="ed-tip">Each clip on the main track ends on the song's nearest beat, so cuts land with the music.</p>
            <button className="ed-button wide" disabled={!total || beatBusy || Boolean(timeline && mainLayer(timeline).locked)} onClick={() => { void cutClipsToBeat(); }}>{beatBusy ? <LoaderCircle className="spin" size={14}/> : <AudioLines size={14}/>}{beatBusy ? 'Listening for the beat…' : 'Cut clips to the beat'}</button>
            {beatNote && <p className="ed-tip" role="status">{beatNote}</p>}</section>}
          </>}
          {part === 'lyrics' && <>
          <LyricSectionsPanel/>
          <SectionLightsPanel/>
          </>}
          {part === 'voice' && <NarratePanel/>}
          {part === 'sounds' && <>
          {!layout.simple && <section className="ed-add" aria-label="Whooshes and hits"><h3 className="ed-sub">Whooshes and hits</h3><p className="ed-tip">A whoosh on each cut and a hit on each title, landed on the moment.</p>
            {(['whoosh', 'hit'] as const).map((kind) => { const choices = (soundEffects ?? []).filter((effect) => effect.kind === kind); const placed = timeline ? timeline.layers.some((layer) => layer.kind === 'audio' && layer.items.some((sound) => sound.name === (kind === 'whoosh' ? 'Whoosh' : 'Hit'))) : false; return <div key={kind} className="ed-sfx">
              <label className="ed-field">{kind === 'whoosh' ? 'Whoosh' : 'Hit'}<select value={sfxChoice[kind]} onChange={(event) => setSfxChoice({ ...sfxChoice, [kind]: event.target.value })}>{choices.length ? choices.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}{effect.own ? '' : ' · your library'}</option>) : <option value={`kanaa-${kind}`}>{kind === 'whoosh' ? "Kanaa's whoosh" : "Kanaa's hit"}</option>}</select></label>
              <div className="ed-pair-small"><button className="ed-button" disabled={!total || sfxBusy !== null} onClick={() => { void addSoundEffects(kind); }}>{sfxBusy === kind ? <LoaderCircle className="spin" size={13}/> : <AudioLines size={13}/>}{kind === 'whoosh' ? 'On transitions' : 'On titles'}</button>
                {placed && <button className="ed-icon small" aria-label={`Remove the ${kind === 'whoosh' ? 'whooshes' : 'hits'}`} title="Remove them" onClick={() => { if (timeline) change(removeEffects(timeline, kind)); }}><X size={13}/></button>}</div></div>; })}
            {sfxNote && <p className="ed-tip" role="status">{sfxNote}</p>}
            {soundEffects && soundEffects.every((effect) => effect.own) && <p className="ed-tip">Whooshes and hits in your music library (by name, under 30 seconds) show here too.</p>}</section>}
          <DocumentarySoundPanel/>
          </>}
        </>}</>);
}
