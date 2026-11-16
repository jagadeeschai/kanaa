import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inLanguage } from './language';
import type { Clip } from '../../src/timeline/model';

const clip: Clip = {
  id: 'c1', media_id: 1, start: 0, in: 0, out: 10, speed: 1, volume: 1, muted: false, enabled: true, fade_in: 0, fade_out: 0, frame_locked: true,
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
  adjust: { rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1, gamma: 1, temperature: 1, tint: 1, fade: 0 },
};
const noop = () => {};

/** The clip panel for a video clip, with everything but the clip and its change handler switched off. */
async function panel(language: 'en' | 'ta', overrides: Partial<Clip> = {}, sourceKind: 'video' | 'image' = 'video') {
  const { Inspector } = await inLanguage(language, () => import('../../src/editor/inspectors/ClipInspector'));
  const { EditorContext, InspectorBindingsProvider } = await import('../../src/editor/state/EditorContext');
  const { emptyTimeline } = await import('../../src/timeline/model');
  const shared = { timeline: emptyTimeline({ width: 1920, height: 1080, fps: 30 }), change: noop, pause: noop, openGuide: noop, now: 0, seek: noop, selectedId: null, select: noop };
  const onChange = vi.fn();
  render(<EditorContext.Provider value={shared}><InspectorBindingsProvider name="clip" bindings={{ onReframe: null, reframing: false, onMove: noop, backgrounds: [], onBackground: noop, logos: [], clipBrandMarks: [], onClipBrand: noop, onRemoveClipBrand: noop, clip: { ...clip, ...overrides }, source: { url: '', kind: sourceKind, width: 1920, height: 1080, duration: 10 }, onChange: onChange, canDetach: false, onDetach: noop, follow: null, isMain: true, copyReady: false, onLayout: noop, picking: false, onPick: noop, timing: [{ label: 'Start', value: 0, fps: 30 }, { label: 'Duration', value: 10, fps: 30 }], overlay: null, onLayer: noop, closesWithTransition: false, onShowEnter: noop, onShowExit: noop }}><Inspector/></InspectorBindingsProvider></EditorContext.Provider>);
  return onChange;
}
const tab = (name: string) => userEvent.click(screen.getAllByRole('button', { name })[0]);
const groups = () => [...document.querySelectorAll('.ed-group-head span')].map((el) => el.textContent);

describe('Clip panel', () => {
  it('has Frame, Colour, Effects, Backdrop, Motion and Sound tabs', async () => {
    await panel('en');
    for (const name of ['Frame', 'Colour', 'Effects', 'Backdrop', 'Motion', 'Sound']) expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
  });

  it('offers every effect in one Add an effect row, not a group each; adding one changes the clip', async () => {
    const onChange = await panel('en');
    await tab('Effects');
    expect(groups()).toContain('Add an effect');
    for (const title of ['Colour splash', 'Dreamy glow', 'Mirror and kaleidoscope', 'Zoom blur', 'Echo trail', 'Beat pulse', 'Old film', 'Signal damage', 'Lens surface']) {
      expect(groups()).not.toContain(title);  // Not on this clip yet: no empty group for it.
      expect(screen.getByRole('button', { name: title })).toBeTruthy();
    }
    expect(groups()).not.toContain('Animation');
    await userEvent.click(screen.getByRole('button', { name: 'Dreamy glow' }));
    expect(onChange.mock.calls.some(([changes]) => Boolean(changes.dreamy_glow))).toBe(true);
  });

  it('a picture on the main track offers Pop-out (3D) under Effects; a video does not', async () => {
    await panel('en', {}, 'image');
    await tab('Effects');
    expect(groups()).toContain('Pop-out (3D)');
    expect(screen.getByRole('button', { name: 'Make it 3D…' })).toBeTruthy();
  });

  it('a video clip has no Pop-out group', async () => {
    await panel('en');
    await tab('Effects');
    expect(groups()).not.toContain('Pop-out (3D)');
  });

  it('Colour has the looks; picking one changes the clip', async () => {
    const onChange = await panel('en');
    await tab('Colour');
    expect(groups()).toContain('Colour');
    await userEvent.click(screen.getByRole('button', { name: 'Warm' }));
    expect(onChange.mock.calls.some(([changes]) => changes.look === 'warm')).toBe(true);
  });

  it('Motion has the clip’s animation and moves', async () => {
    await panel('en');
    await tab('Motion');
    expect(groups()).toEqual(expect.arrayContaining(['Animation', 'Moves']));
  });

  it('shows a clip’s effects on one folded line', async () => {
    await panel('en', { dreamy_glow: { intensity: 0.45, softness: 0.5, warmth: 0.2 } });
    expect(screen.getByText(/Effects \(1\/1\)/)).toBeTruthy();
  });

  it('is in Tamil when the interface is', async () => {
    await panel('ta');
    expect(screen.getByRole('button', { name: 'விளைவுகள்' })).toBeTruthy();  // Effects
  });
});
