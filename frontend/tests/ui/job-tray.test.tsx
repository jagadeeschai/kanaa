import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const jobs = [
  { job_id: 'a', kind: 'export', label: 'Exporting My song', status: 'running', progress: 40, done: false, phase: null, error: null, output_photo_id: null },
  { job_id: 'b', kind: 'depth', label: 'Making scene 3D', status: 'failed', progress: 0, done: true, phase: null, error: 'TypeError: Failed to fetch', output_photo_id: null, can_retry: true },
  { job_id: 'c', kind: 'echo', label: 'Echo trail', status: 'failed', progress: 0, done: true, phase: null, error: null, output_photo_id: null },
];
const cancel = vi.fn(() => Promise.resolve({}));
const retry = vi.fn(() => Promise.resolve({}));
vi.mock('../../src/api/client', () => ({ getRenderJobs: () => Promise.resolve(jobs), cancelRenderJob: (id: string) => cancel(id), retryRenderJob: (id: string) => retry(id) }));

describe('Jobs tray', () => {
  it('counts running jobs, lists them with plain failure words, and cancels', async () => {
    const { default: JobTray } = await import('../../src/editor/JobTray');
    render(<JobTray/>);
    expect(await screen.findByText('1')).toBeTruthy();  // One job running.
    await userEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    expect(screen.getByText('Exporting My song')).toBeTruthy();
    expect(screen.getByText(/could not reach its engine/)).toBeTruthy();  // A technical error in plain words.
    expect(screen.getByText('Could not finish')).toBeTruthy();  // A failure with no message still says something.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel: Exporting My song' }));
    expect(cancel).toHaveBeenCalledWith('a');
    // Only a job Kanaa can run again offers Try again.
    expect(screen.queryByRole('button', { name: 'Try again: Echo trail' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again: Making scene 3D' }));
    expect(retry).toHaveBeenCalledWith('b');
  });
});
