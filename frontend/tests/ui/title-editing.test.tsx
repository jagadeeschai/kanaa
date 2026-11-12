import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inLanguage } from './language';
import type { TextItem } from '../../src/timeline/model';

const title: TextItem = { id: 't1', start: 0, length: 3, text: 'முதல் வரி', style: 'shadow', position: 'bottom', color: '#ffffff', size: 44 };

describe('Typing into a title in the preview', () => {
  it('starts with the title’s words and keeps new words on Enter', async () => {
    const { TitleEditBox } = await inLanguage('en', () => import('../../src/editor/preview/TitleEditing'));
    const done = vi.fn();
    render(<TitleEditBox text={title} style={{}} onDone={done}/>);
    const box = screen.getByRole('textbox', { name: 'Title words' });
    expect(box.textContent).toBe('முதல் வரி');
    box.textContent = 'புதிய வரி';
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(done).toHaveBeenCalledWith('புதிய வரி');
  });

  it('Esc puts the words back', async () => {
    const { TitleEditBox } = await inLanguage('en', () => import('../../src/editor/preview/TitleEditing'));
    const done = vi.fn();
    render(<TitleEditBox text={title} style={{}} onDone={done}/>);
    const box = screen.getByRole('textbox', { name: 'Title words' });
    box.textContent = 'changed';
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(done).toHaveBeenCalledWith(null);
    expect(done).toHaveBeenCalledTimes(1);  // Leaving after Esc doesn't save as well.
    fireEvent.blur(box);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('Enter while the Tamil keyboard is still composing a letter does not finish', async () => {
    const { TitleEditBox } = await inLanguage('en', () => import('../../src/editor/preview/TitleEditing'));
    const done = vi.fn();
    render(<TitleEditBox text={title} style={{}} onDone={done}/>);
    const box = screen.getByRole('textbox', { name: 'Title words' });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(done).not.toHaveBeenCalled();
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter starts a new line instead of finishing', async () => {
    const { TitleEditBox } = await inLanguage('en', () => import('../../src/editor/preview/TitleEditing'));
    const done = vi.fn();
    render(<TitleEditBox text={title} style={{}} onDone={done}/>);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title words' }), { key: 'Enter', shiftKey: true });
    expect(done).not.toHaveBeenCalled();
  });
});

describe('The title toolbar in the preview', () => {
  it('changes size, style and Tamil font, and opens typing', async () => {
    const { TitleToolbar } = await inLanguage('en', () => import('../../src/editor/preview/TitleEditing'));
    const change = vi.fn(), edit = vi.fn();
    render(<TitleToolbar text={title} top={0.5} left={0.5} onChange={change} onEdit={edit}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Bigger' }));
    expect(change).toHaveBeenLastCalledWith({ size: 46 }, 'size-t1');
    await userEvent.click(screen.getByRole('button', { name: 'Smaller' }));
    expect(change).toHaveBeenLastCalledWith({ size: 42 }, 'size-t1');
    await userEvent.click(screen.getByTitle('Band'));
    expect(change).toHaveBeenLastCalledWith({ style: 'band' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tamil font' }), 'Arima');
    expect(change).toHaveBeenLastCalledWith({ tamil_font: 'Arima' });
    await userEvent.click(screen.getByRole('button', { name: 'Type' }));
    expect(edit).toHaveBeenCalled();
  });

  it('keeps sizes within 20 to 100', async () => {
    const { TitleToolbar } = await inLanguage('en', () => import('../../src/editor/preview/TitleEditing'));
    const change = vi.fn();
    render(<TitleToolbar text={{ ...title, size: 100 }} top={0.5} left={0.5} onChange={change} onEdit={vi.fn()}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Bigger' }));
    expect(change).toHaveBeenLastCalledWith({ size: 100 }, 'size-t1');
  });

  it('is in Tamil when the interface is', async () => {
    const { TitleToolbar } = await inLanguage('ta', () => import('../../src/editor/preview/TitleEditing'));
    render(<TitleToolbar text={title} top={0.5} left={0.5} onChange={vi.fn()} onEdit={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'பெரிதாக்கு' })).toBeTruthy();
  });
});
