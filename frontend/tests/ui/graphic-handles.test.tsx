import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GraphicHandles } from '../../src/editor/preview/GraphicHandles';

const arrow = { kind: 'arrow-straight' as const, style: 'clean' as const, from: [.2, .2] as [number, number], to: [.7, .6] as [number, number], width: .25, height: .18, line_width: .006 };

beforeAll(() => { HTMLElement.prototype.setPointerCapture = vi.fn(); });

describe('Graphic preview handles', () => {
  it('shows independently draggable arrow tail and point handles', () => {
    const change = vi.fn();
    render(<div><GraphicHandles graphic={arrow} onChange={change}/></div>);
    const frame = screen.getByLabelText('Graphic handles');
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    const tail = screen.getByRole('button', { name: 'Move arrow tail' });
    fireEvent.pointerDown(tail, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(tail, { pointerId: 1, clientX: 30, clientY: 35 });
    expect(change).toHaveBeenCalledWith({ ...arrow, from: [.3, .35] }, 'graphic-from');
    expect(screen.getByRole('button', { name: 'Move arrow point' })).toBeTruthy();
  });

  it('uses move and resize handles for a highlight', () => {
    render(<GraphicHandles graphic={{ ...arrow, kind: 'circle' }} onChange={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: 'Move arrow tail' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move highlight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize highlight' })).toBeTruthy();
  });
});
