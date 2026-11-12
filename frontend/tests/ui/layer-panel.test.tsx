import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Group, LayerModeContext, Panel } from '../../src/editor/layout';

const tabs = [{ id: 'style', label: 'Text', Icon: () => null }, { id: 'motion', label: 'Motion', Icon: () => null }];
const panel = (layer: boolean) => <LayerModeContext.Provider value={layer}>
  <Panel id="test" tabs={tabs as never}>
    <Group title="Timing">timing</Group>
    <Group title="Text" tab="style" startOpen>text settings</Group>
    <Group title="Keep the title clear of people" tab="style" startOpen>keep clear</Group>
  </Panel>
</LayerModeContext.Provider>;

describe('Layer settings panel', () => {
  it('shows only what a whole layer can style', () => {
    render(panel(true));
    expect(screen.getByText('text settings')).toBeTruthy();
    expect(screen.queryByText('timing')).toBeNull();      // Timing belongs to one item.
    expect(screen.queryByText('keep clear')).toBeNull();  // So does following people.
  });

  it('shows everything for a single item', () => {
    render(panel(false));
    expect(screen.getByText('keep clear')).toBeTruthy();
  });
});
