import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorContext, InspectorBindingsProvider, useEditorPanel, useEditor, useItemTime } from '../../src/editor/state/EditorContext';
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

function BoundPanel() {
  const { label, run } = useEditorPanel<{ label: string; run: () => void }>('text');
  const { timeline } = useEditor();
  return <button onClick={run}>{label}:{timeline.format.width}</button>;
}

describe('Shared panel bindings', () => {
  it('keeps panel actions and the authoritative timeline in the same store', async () => {
    const base = shared(0); const run = vi.fn();
    render(<EditorContext.Provider value={base}><InspectorBindingsProvider name="text" bindings={{ label: 'Title', run }}><BoundPanel/></InspectorBindingsProvider></EditorContext.Provider>);
    await userEvent.click(screen.getByRole('button', { name: 'Title:1920' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(base.timeline.layers[0].items).toEqual([]);
  });

  it('can render loading views before a project timeline is available', () => {
    function LoadingPanel() { const value = useEditorPanel<{ label: string }>('left'); return <span>{value.label}</span>; }
    render(<EditorContext.Provider value={{ ...shared(0), timeline: null, panels: { left: { label: 'Loading media' } } }}><LoadingPanel/></EditorContext.Provider>);
    expect(screen.getByText('Loading media')).toBeTruthy();
  });
});
