import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inLanguage } from './language';
import type { Command } from '../../src/editor/CommandPalette';

const commands = (run: () => void): Command[] => [
  { id: 'split', label: 'Split at the playhead', group: 'Edit', hint: 'S', run },
  { id: 'export', label: 'Export', group: 'Video', run, keywords: 'save mp4' },
  { id: 'sync', label: 'Fix lyric timing: Lyrics', group: 'Layers', run, keywords: 'sync shift stretch' },
];

describe('⌘K command palette', () => {
  it('finds by words or keywords, groups under headings, and runs on Enter', async () => {
    const { default: CommandPalette } = await inLanguage('en', () => import('../../src/editor/CommandPalette'));
    const run = vi.fn(), close = vi.fn();
    render(<CommandPalette commands={commands(run)} onSettings={vi.fn()} onClose={close}/>);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'mp4');
    expect(screen.getByText('Export')).toBeTruthy();
    expect(screen.queryByText('Split at the playhead')).toBeNull();
    expect(screen.getByText('Video')).toBeTruthy();  // Its group heading.
    await userEvent.keyboard('{Enter}');
    expect(close).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('always offers to search the settings for the words typed', async () => {
    const { default: CommandPalette } = await inLanguage('en', () => import('../../src/editor/CommandPalette'));
    const onSettings = vi.fn();
    render(<CommandPalette commands={commands(vi.fn())} onSettings={onSettings} onClose={vi.fn()}/>);
    await userEvent.type(screen.getByRole('combobox'), 'frame rate');
    await userEvent.click(screen.getByText(/Find in settings/));
    expect(onSettings).toHaveBeenCalledWith('frame rate');
  });

  it('arrow keys move through the results and Esc closes', async () => {
    const { default: CommandPalette } = await inLanguage('en', () => import('../../src/editor/CommandPalette'));
    const close = vi.fn();
    render(<CommandPalette commands={commands(vi.fn())} onSettings={vi.fn()} onClose={close}/>);
    const options = () => screen.getAllByRole('option');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    await userEvent.type(screen.getByRole('combobox'), '{ArrowDown}');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalled();
  });

  it('shows the last actions first, under Recent, when nothing is typed', async () => {
    const { default: CommandPalette } = await inLanguage('en', () => import('../../src/editor/CommandPalette'));
    const run = vi.fn();
    const first = render(<CommandPalette commands={commands(run)} onSettings={vi.fn()} onClose={vi.fn()}/>);
    await userEvent.type(screen.getByRole('combobox'), 'lyric{Enter}');
    expect(run).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<CommandPalette commands={commands(run)} onSettings={vi.fn()} onClose={vi.fn()}/>);
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('Fix lyric timing');
    expect(screen.getByText('Recent')).toBeTruthy();
  });

  it('speaks Tamil when the interface is in Tamil', async () => {
    const { default: CommandPalette } = await inLanguage('ta', () => import('../../src/editor/CommandPalette'));
    render(<CommandPalette commands={commands(vi.fn())} onSettings={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByPlaceholderText('என்ன செய்ய வேண்டும் என்று தட்டச்சிடுங்கள்…')).toBeTruthy();
    await userEvent.type(screen.getByRole('combobox'), 'export');
    expect(screen.getByText(/அமைப்புகளில் தேடு/)).toBeTruthy();
  });
});
