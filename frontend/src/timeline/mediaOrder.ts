/** The Media panel's sorting and filtering, kept apart from the panel so it can be tested. */
export type MediaSort = 'newest' | 'oldest' | 'name' | 'kind';
export const MEDIA_SORTS: { id: MediaSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }, { id: 'name', label: 'Name A–Z' }, { id: 'kind', label: 'Pictures, then videos' },
];
type Item = { id: number; filename: string; media_type: string; created_at?: string | null };

const made = (item: Item) => (item.created_at ? Date.parse(item.created_at.replace(' ', 'T')) || item.id : item.id);
const byName = (a: Item, b: Item) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });

/** `items` in the chosen order: newest and oldest by when they were added (then id), names in natural order (2 before 10). */
export function sortMedia<T extends Item>(items: T[], sort: MediaSort): T[] {
  const list = [...items];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'kind') return list.sort((a, b) => (a.media_type === b.media_type ? byName(a, b) : a.media_type === 'image' ? -1 : 1));
  const direction = sort === 'newest' ? -1 : 1;
  return list.sort((a, b) => (made(a) - made(b) || a.id - b.id) * direction);
}
