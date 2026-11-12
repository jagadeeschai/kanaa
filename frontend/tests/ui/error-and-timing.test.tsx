import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inLanguage } from './language';

describe('Error banner', () => {
  it('says what went wrong in plain words, with the original under Details', async () => {
    const { default: ErrorBanner } = await inLanguage('en', () => import('../../src/editor/ErrorBanner'));
    const dismiss = vi.fn();
    render(<ErrorBanner message="TypeError: Failed to fetch" onDismiss={dismiss}/>);
    expect(screen.getByText(/could not reach its engine/)).toBeTruthy();
    expect(screen.queryByText('TypeError: Failed to fetch')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('TypeError: Failed to fetch')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismiss).toHaveBeenCalled();
  });

  it('shows a message written for people as it is, with no Details', async () => {
    const { default: ErrorBanner } = await inLanguage('en', () => import('../../src/editor/ErrorBanner'));
    render(<ErrorBanner message="Put the title over a video with people in it first." onDismiss={vi.fn()}/>);
    expect(screen.getByText(/Put the title over a video/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
  });

  it('speaks Tamil', async () => {
    const { default: ErrorBanner } = await inLanguage('ta', () => import('../../src/editor/ErrorBanner'));
    render(<ErrorBanner message="Failed to fetch" onDismiss={vi.fn()}/>);
    expect(screen.getByText(/கனா தன் இயந்திரத்தை அணுக முடியவில்லை/)).toBeTruthy();
  });
});

describe('Timing summary', () => {
  it('reads as start → end · length', async () => {
    const { timingSummary } = await import('../../src/editor/Timing');
    expect(timingSummary([{ label: 'Start', value: 4.2, fps: 30 }, { label: 'Duration', value: 5, fps: 30 }])).toBe('0:04 → 0:09 · 5.0s');
    expect(timingSummary([{ label: 'Start', value: 75, fps: 30 }, { label: 'Length', value: 42, fps: 30 }])).toBe('1:15 → 1:57 · 42s');
    expect(timingSummary([])).toBe('');
  });
});
