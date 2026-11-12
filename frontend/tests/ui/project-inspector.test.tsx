import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inLanguage } from './language';
import { emptyTimeline } from '../../src/timeline/model';

const logo = { id: 96, filename: 'Gold leaf logo.png', media_type: 'image', width: 800, height: 800, folder: 'Brand' };
const noop = () => {};

async function panel(language: 'en' | 'ta') {
  const { ProjectInspector } = await inLanguage(language, () => import('../../src/editor/inspectors/ProjectInspector'));
  const { EditorContext } = await import('../../src/editor/state/EditorContext');
  const onChange = vi.fn();
  const shared = { timeline: emptyTimeline({ width: 1920, height: 1080, fps: 30 }), change: onChange, pause: noop, openGuide: noop };
  render(<EditorContext.Provider value={shared}><ProjectInspector introBusy={null} onBrandIntro={noop} clipFormat={null}
    logos={[logo as never]} logo={null} onBrand={noop} onImported={noop} onRemoveBrand={noop} onThemes={noop}/></EditorContext.Provider>);
  return onChange;
}
const tab = (name: string) => userEvent.click(screen.getAllByRole('button', { name })[0]);
const groups = () => [...document.querySelectorAll('.ed-group-head span')].map((el) => el.textContent);

describe('Project settings', () => {
  it('has four tabs: Format, Colour & finish, Brand, Sound', async () => {
    await panel('en');
    for (const name of ['Format', 'Colour & finish', 'Brand', 'Sound']) expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
  });

  it('Format holds the shape; choosing YouTube makes the video 16:9', async () => {
    const onChange = await panel('en');
    expect(groups()).toContain('Shape and size');
    await userEvent.click(screen.getByText('YouTube'));
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.format.width / next.format.height).toBeCloseTo(16 / 9, 2);
  });

  it('Brand holds the watermark and the brand intro, with the brand logos to choose from', async () => {
    await panel('en');
    await tab('Brand');
    expect(groups()).toEqual(expect.arrayContaining(['Brand watermark', 'Brand intro']));
    await userEvent.click(screen.getAllByRole('combobox', { name: 'Choose a logo image' })[0]);
    expect(screen.getAllByText('Gold leaf logo.png').length).toBeGreaterThan(0);
  });

  it('Colour & finish holds the theme and the cinematic finish', async () => {
    await panel('en');
    await tab('Colour & finish');
    expect(groups()).toEqual(expect.arrayContaining(['Theme', 'Cinematic finish']));
  });

  it('is in Tamil when the interface is', async () => {
    await panel('ta');
    expect(screen.getAllByRole('button', { name: 'பிராண்ட்' }).length).toBeGreaterThan(0);  // Brand
  });
});
