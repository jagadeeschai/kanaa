import { useEffect, useRef, useState } from 'react';
import { getVideoProject, saveVideoProject } from '../api/client';

// Serialize saves even when an editor closes and immediately reopens.
const writes = new Map<number, Promise<unknown>>();
function persist(id: number, kind: string, serialized: string) {
  const next = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(() => saveVideoProject(id, kind, JSON.parse(serialized)));
  writes.set(id, next);
  void next.finally(() => { if (writes.get(id) === next) writes.delete(id); }).catch(() => {});
  return next;
}

export function useVideoProject<T extends object>(id: number, kind: 'edit' | 'lyric', recipe: T | null, restore: (recipe: T) => void | Promise<void>) {
  const [loaded, setLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef('null');
  const latest = useRef(JSON.stringify(recipe));
  latest.current = JSON.stringify(recipe);
  const restoreRef = useRef(restore); restoreRef.current = restore;
  const ready = useRef(false);
  const save = (serialized: string) => {
    saved.current = serialized;
    setSaving(true);
    void persist(id, kind, serialized).then(() => setSaveFailed(false)).catch(() => { saved.current = ''; setSaveFailed(true); }).finally(() => setSaving(false));
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await writes.get(id)?.catch(() => {});
        const project = await getVideoProject<T>(id, kind);
        if (cancelled) return;
        if (project.recipe) { saved.current = JSON.stringify(project.recipe); await restoreRef.current(project.recipe); }
        if (!cancelled) { ready.current = true; setLoaded(true); }
      } catch { if (!cancelled) setSaveFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [id, kind]);
  const serialized = latest.current;
  useEffect(() => {
    if (!loaded || serialized === saved.current) return;
    const timer = setTimeout(() => saveRef.current(latest.current), 650);
    return () => clearTimeout(timer);
  }, [loaded, serialized]);
  useEffect(() => () => { if (ready.current && latest.current !== saved.current) saveRef.current(latest.current); }, []);
  return { loaded, saveFailed, saving: !loaded || saving || serialized !== saved.current };
}
