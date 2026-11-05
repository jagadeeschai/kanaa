import { useEffect, useRef, useState } from 'react';
import { Car, LoaderCircle, MapPin, Plane, Plus, Ship, TrainFront, X } from 'lucide-react';
import { downloadTravelMapData, makeTravelMap, searchPlaces, travelMapStatus, waitForJob, type MapPlace } from '../api/client';

const MODES = [{ id: 'flight', label: 'Flight', Icon: Plane }, { id: 'car', label: 'Road', Icon: Car }, { id: 'train', label: 'Train', Icon: TrainFront }, { id: 'boat', label: 'Boat', Icon: Ship }] as const;
const STYLES = [{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Night' }, { id: 'vintage', label: 'Vintage' }] as const;
const LANGUAGES = [{ id: 'en', label: 'English' }, { id: 'ta', label: 'தமிழ்' }, { id: 'both', label: 'Both' }] as const;

/** One place: type to search the downloaded place list, then pick. */
function PlaceField({ label, value, onPick, onClear }: { label: string; value: MapPlace | null; onPick: (place: MapPlace) => void; onClear?: () => void }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<MapPlace[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    if (text.trim().length < 2) { setFound([]); return; }
    timer.current = setTimeout(() => { searchPlaces(text).then((answer) => setFound(answer.places)).catch(() => setFound([])); }, 200);
    return () => clearTimeout(timer.current);
  }, [text]);
  if (value) return <div className="ed-map-place"><MapPin size={13}/><span><b>{value.name}</b>{value.tamil && <em lang="ta"> {value.tamil}</em>}{value.country && <small> · {value.country}</small>}</span>
    <button className="ed-icon small" aria-label={`Change ${label}`} title="Change" onClick={() => onClear?.()}><X size={12}/></button></div>;
  return <div className="ed-map-search"><input aria-label={label} placeholder={`${label}: type a town or city`} value={text} onChange={(event) => setText(event.target.value)}/>
    {found.length > 0 && <ul role="listbox" aria-label={`${label} matches`}>{found.map((place) => <li key={place.id ?? `${place.lat},${place.lon}`}><button role="option" aria-selected={false} onClick={() => { onPick(place); setText(''); setFound([]); }}>
      <b>{place.name}</b>{place.tamil && <em lang="ta"> {place.tamil}</em>}<small> · {place.country}</small></button></li>)}</ul>}</div>;
}

/** Travel map: places, how each part is travelled, a look; Kanaa draws the route as a clip. */
export default function TravelMapPanel({ format, onMade }: { format: { width: number; height: number }; onMade: (mediaId: number) => Promise<void> }) {
  const [status, setStatus] = useState<{ ready: boolean; size_mb: number; sources: string } | null>(null);
  const [stops, setStops] = useState<(MapPlace | null)[]>([null, null]);
  const [modes, setModes] = useState<string[]>(['flight']);
  const [style, setStyle] = useState('light');
  const [language, setLanguage] = useState('both');
  const [progress, setProgress] = useState<{ what: string; value: number } | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { travelMapStatus().then(setStatus).catch((problem) => setNote((problem as Error).message)); }, []);

  const download = async () => {
    if (!status || !window.confirm(`Travel maps need map outlines from Natural Earth and a list of places from GeoNames (about ${status.size_mb} MB, free). Download them once now? They stay on this Mac; searching places then works offline.`)) return;
    setProgress({ what: 'Downloading map data…', value: 0 }); setNote('');
    try { const { job_id } = await downloadTravelMapData(); await waitForJob(job_id, (value) => setProgress({ what: 'Downloading map data…', value })); setStatus(await travelMapStatus()); }
    catch (problem) { setNote((problem as Error).message); } finally { setProgress(null); }
  };
  const make = async () => {
    const chosen = stops.filter((stop): stop is MapPlace => Boolean(stop));
    if (chosen.length !== stops.length || chosen.length < 2) { setNote('Choose every place first.'); return; }
    setProgress({ what: 'Drawing the map…', value: 0 }); setNote('');
    try {
      const { job_id } = await makeTravelMap({ stops: chosen, modes, style, language, width: format.width, height: format.height });
      const done = await waitForJob<{ media_id: number; fallback: boolean[] }>(job_id, (value) => setProgress({ what: 'Drawing the map…', value }));
      await onMade(done.media_id);
      setNote(done.fallback.some(Boolean) ? 'Added at the playhead. The road route service could not be reached, so road parts are drawn as a curve; try again later for the real road.' : 'Added at the playhead. Trim it, add a title or a whoosh like any clip.');
    } catch (problem) { setNote((problem as Error).message); } finally { setProgress(null); }
  };

  return <section className="ed-add ed-map" aria-label="Travel map">
    <h3 className="ed-sub">Travel map</h3>
    <p className="ed-tip">The way from one place to the next: a plane along its arc, or a car along the road, with the names on the map.</p>
    {status && !status.ready ? <><button className="ed-button wide" disabled={Boolean(progress)} onClick={() => { void download(); }}><MapPin size={14}/>Get map data ({status.size_mb} MB, once)</button>
      <p className="ed-tip">Free map outlines and place names ({status.sources}). Kanaa asks before downloading.</p></>
    : status && <>
      {stops.map((stop, index) => <div key={index}>
        {index > 0 && <div className="ed-chips ed-map-modes" role="group" aria-label={`How to travel to place ${index + 1}`}>{MODES.map(({ id, label, Icon }) => <button key={id} className={modes[index - 1] === id ? 'on' : ''} aria-pressed={modes[index - 1] === id} title={label} onClick={() => setModes(modes.map((mode, at) => (at === index - 1 ? id : mode)))}><Icon size={13}/>{label}</button>)}</div>}
        <div className="ed-map-row"><PlaceField label={index === 0 ? 'From' : index === stops.length - 1 ? 'To' : `Stop ${index}`} value={stop} onPick={(place) => setStops(stops.map((each, at) => (at === index ? place : each)))} onClear={() => setStops(stops.map((each, at) => (at === index ? null : each)))}/>
          {stops.length > 2 && <button className="ed-icon small" aria-label={`Remove place ${index + 1}`} title="Remove this place" onClick={() => { setStops(stops.filter((_, at) => at !== index)); setModes(modes.filter((_, at) => at !== Math.max(0, index - 1))); }}><X size={12}/></button>}</div>
      </div>)}
      {stops.length < 6 && <button className="ed-button" onClick={() => { setStops([...stops, null]); setModes([...modes, 'car']); }}><Plus size={13}/>Add a stop</button>}
      <div className="ed-add-row"><span>Look</span><div className="ed-chips" role="group" aria-label="Map look">{STYLES.map((item) => <button key={item.id} className={style === item.id ? 'on' : ''} aria-pressed={style === item.id} onClick={() => setStyle(item.id)}>{item.label}</button>)}</div></div>
      <div className="ed-add-row"><span>Names</span><div className="ed-chips" role="group" aria-label="Place names">{LANGUAGES.map((item) => <button key={item.id} className={language === item.id ? 'on' : ''} aria-pressed={language === item.id} onClick={() => setLanguage(item.id)}>{item.label}</button>)}</div></div>
      <button className="ed-primary wide" disabled={Boolean(progress) || stops.some((stop) => !stop)} onClick={() => { void make(); }}>{progress ? <LoaderCircle className="spin" size={14}/> : <MapPin size={14}/>}Make the map</button>
      <p className="ed-tip">Flights and place search work on this Mac. Road trips ask the free OSRM route service for the road (only the two points are sent, no key); road data © OpenStreetMap contributors. Trains follow the road route.</p>
    </>}
    {progress && <><div className="ed-progress"><i style={{ width: `${progress.value}%` }}/></div><p className="ed-tip" role="status">{progress.what} {progress.value}%</p></>}
    {note && <p className="ed-tip" role="status">{note}</p>}
  </section>;
}
