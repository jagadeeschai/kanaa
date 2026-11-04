export function nextTabIndex(current: number, count: number, key: string, columns = count): number {
  if (count < 1) return current;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'ArrowDown') return (current + columns) % count;
  if (key === 'ArrowUp') return (current - columns + count) % count;
  return current;
}
