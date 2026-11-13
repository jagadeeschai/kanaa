import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { collapseAllGroups, Group, More } from '../../src/editor/layout';

describe('Collapse all', () => {
  it('closes every open section at once', () => {
    render(<div><Group title="Frame" startOpen><p>frame settings</p></Group><Group title="Colour" startOpen><p>colour settings</p></Group></div>);
    expect(screen.getByText('frame settings')).toBeTruthy();
    expect(screen.getByText('colour settings')).toBeTruthy();
    act(() => collapseAllGroups());
    expect(screen.queryByText('frame settings')).toBeNull();
    expect(screen.queryByText('colour settings')).toBeNull();
  });
});

describe('More options', () => {
  it('is not shown when it has nothing inside', () => {
    const photo = false;
    render(<div><More>{photo && <p>steady</p>}</More><More label="Extra"><p>something</p></More></div>);
    expect(screen.queryByText('More options')).toBeNull();
    expect(screen.getByText('Extra')).toBeTruthy();
  });
});
