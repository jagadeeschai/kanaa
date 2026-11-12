import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LyricSyncFix from '../../src/components/LyricSyncFix';

const cues = [1, 5, 9, 13].map((start, i) => ({ start, end: start + 3, text: `line ${i + 1}` }));

describe('Fix sync', () => {
  it('shifts every line later by half a second', async () => {
    const onChange = vi.fn();
    render(<LyricSyncFix cues={cues} duration={60} position={0} onSeek={vi.fn()} onChange={onChange}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Later by 0.5 seconds' }));
    expect(onChange.mock.calls[0][0].map((cue: { start: number }) => cue.start)).toEqual([1.5, 5.5, 9.5, 13.5]);
  });

  it('stretches between two lines placed with Now', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<LyricSyncFix cues={cues} duration={60} position={0} onSeek={vi.fn()} onChange={onChange}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Stretch' }));
    rerender(<LyricSyncFix cues={cues} duration={60} position={15.5} onSeek={vi.fn()} onChange={onChange}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Line 4 is sung now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange.mock.calls[0][0].map((cue: { start: number }) => cue.start)).toEqual([1, 5.833, 10.667, 15.5]);
  });
});
