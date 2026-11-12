import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inLanguage } from './language';
import type { TextItem } from '../../src/timeline/model';

const title: TextItem = { id: 't1', start: 1, length: 4, text: 'முதல் வரி', style: 'shadow', position: 'bottom', color: '#ffffff', size: 44 };
const noop = () => {};

/** The title panel with everything but its title and change handler switched off. */
async function panel(language: 'en' | 'ta', options: { layer?: boolean; text?: TextItem } = {}) {
  const { TextInspector } = await inLanguage(language, () => import('../../src/editor/inspectors/TextInspector'));
  const { LayerModeContext } = await import('../../src/editor/layout');
  const { EditorContext } = await import('../../src/editor/state/EditorContext');
  const { emptyTimeline } = await import('../../src/timeline/model');
  const onChange = vi.fn();
  const props = {
    staying: null, stayNote: null, onStay: noop, onStopStay: noop, onStayCover: noop, text: options.text ?? title, groundGap: 0 as const, onGroundGap: noop,
    onSaveStyle: noop, onCinema: noop, onCinemaFront: noop, onCinemaClear: noop, pinning: null, onPin: noop, placing: null, onPlace: noop, onSurface: noop,
    clearing: null, clearNote: null, clearUnder: null, onKeepClear: noop, onRemoveClear: noop, onBehindShape: noop, cover: 'front' as const, shapingMode: null,
    timing: [{ label: 'Start', value: 1, fps: 30 }, { label: 'Duration', value: 4, fps: 30 }], local: 0, onSeekLocal: noop, follow: null, onChange, onEnter: noop, onExit: noop,
  };
  const shared = { timeline: emptyTimeline({ width: 1920, height: 1080, fps: 30 }), change: noop, pause: noop, openGuide: noop };
  render(<EditorContext.Provider value={shared}><LayerModeContext.Provider value={Boolean(options.layer)}><TextInspector {...props}/></LayerModeContext.Provider></EditorContext.Provider>);
  return onChange;
}

describe('Title panel', () => {
  it('keeps the words with their font, size, colour and style in one Text section', async () => {
    await panel('en');
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy();
    for (const label of ['Tamil font', 'English font', 'Style', 'Position', 'Alignment']) expect(screen.getByRole('group', { name: label })).toBeTruthy();
    for (const label of ['Size', 'Colour', 'Letter spacing']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('typing changes the words; picking a style changes the style', async () => {
    const onChange = await panel('en');
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    expect(onChange).toHaveBeenLastCalledWith({ text: 'முதல் வரி!' }, 'text-t1');
    await userEvent.click(screen.getByRole('button', { name: 'Band' }));
    expect(onChange).toHaveBeenLastCalledWith({ style: 'band' });
  });

  it('never saves an empty title', async () => {
    const onChange = await panel('en');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ text: '' }), expect.anything());
  });

  it('timing is folded to one line', async () => {
    await panel('en');
    expect(screen.getByText('0:01 → 0:05 · 4.0s')).toBeTruthy();
  });

  it('a whole layer has no words to type', async () => {
    await panel('en', { layer: true });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getAllByText('Size').length).toBeGreaterThan(0);
  });

  it('Motion reads in three steps: in and out, while on screen, following the scene', async () => {
    await panel('en');
    await userEvent.click(screen.getAllByRole('button', { name: 'Motion' })[0]);
    const order = [...document.querySelectorAll('.ed-tab-heading, .ed-group-head span')].map((el) => el.textContent);
    const at = (name: string) => order.indexOf(name);
    expect(at('In and out')).toBeLessThan(at('Simple animation'));
    expect(at('Cinematic reveal')).toBeLessThan(at('While on screen'));
    expect(at('While on screen')).toBeLessThan(at('Moves'));
    expect(at('Keyframes')).toBeLessThan(at('Follow the scene'));
    expect(at('Follow the scene')).toBeLessThan(at('Stay with people'));
  });

  it('is in Tamil when the interface is', async () => {
    await panel('ta');
    expect(screen.getByRole('group', { name: 'தமிழ் எழுத்துரு' })).toBeTruthy();  // Tamil font
    expect(screen.getAllByText('எழுத்து இடைவெளி').length).toBeGreaterThan(0);  // Letter spacing
  });
});
