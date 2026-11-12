import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorContext, useItemTime } from '../../src/editor/state/EditorContext';
import { emptyTimeline } from '../../src/timeline/model';

function Probe({ start, length }: { start: number; length: number }) {
  const { local, seekLocal } = useItemTime(start, length);
  return <button onClick={() => seekLocal(1.5)}>{local}</button>;
}
const shared = (now: number, seek = vi.fn()) => ({ timeline: emptyTimeline({ width: 1920, height: 1080, fps: 30 }), change: vi.fn(), pause: vi.fn(), openGuide: vi.fn(), now, seek, selectedId: null, select: vi.fn() });

describe('Editor context', () => {
  it('gives an item the playhead within it, kept inside the item', () => {
    const { rerender } = render(<EditorContext.Provider value={shared(7)}><Probe start={5} length={4}/></EditorContext.Provider>);
    expect(screen.getByRole('button').textContent).toBe('2');
    rerender(<EditorContext.Provider value={shared(20)}><Probe start={5} length={4}/></EditorContext.Provider>);
    expect(screen.getByRole('button').textContent).toBe('4');
    rerender(<EditorContext.Provider value={shared(1)}><Probe start={5} length={4}/></EditorContext.Provider>);
    expect(screen.getByRole('button').textContent).toBe('0');
  });

  it('seeking within an item moves the playhead from the item’s start', async () => {
    const seek = vi.fn();
    render(<EditorContext.Provider value={shared(0, seek)}><Probe start={5} length={4}/></EditorContext.Provider>);
    await userEvent.click(screen.getByRole('button'));
    expect(seek).toHaveBeenCalledWith(6.5);
  });

  it('says clearly when a panel is used outside the editor', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe start={0} length={1}/>)).toThrow(/EditorContext/);
  });
});
