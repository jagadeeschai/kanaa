export type SaveState = 'saved' | 'saving' | 'failed';

/** Debounces edits, serializes writes, and can be awaited before leaving the editor. */
export class ProjectSaveQueue {
  private latest = '';
  private confirmed = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | null = null;
  private readonly write: (serialized: string) => Promise<unknown>;
  private readonly onState: (state: SaveState) => void;
  private readonly delay: number;

  constructor(
    write: (serialized: string) => Promise<unknown>,
    onState: (state: SaveState) => void,
    delay = 650,
  ) {
    this.write = write;
    this.onState = onState;
    this.delay = delay;
  }

  load(serialized: string) {
    this.latest = serialized;
    this.confirmed = serialized;
    this.onState('saved');
  }

  change(serialized: string) {
    this.latest = serialized;
    if (serialized === this.confirmed) {
      this.clearTimer();
      this.onState('saved');
      return;
    }
    this.onState('saving');
    this.clearTimer();
    this.timer = setTimeout(() => { void this.flush(); }, this.delay);
  }

  async flush(): Promise<boolean> {
    this.clearTimer();
    if (this.running) {
      const succeeded = await this.running;
      return succeeded && this.latest === this.confirmed ? true : succeeded && this.flush();
    }
    if (this.latest === this.confirmed) {
      this.onState('saved');
      return true;
    }
    const saving = this.latest;
    this.onState('saving');
    this.running = this.write(saving).then(() => {
      this.confirmed = saving;
      return true;
    }).catch(() => false).finally(() => {
      this.running = null;
    });
    const succeeded = await this.running;
    if (!succeeded) {
      this.onState('failed');
      return false;
    }
    if (this.latest !== this.confirmed) return this.flush();
    this.onState('saved');
    return true;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
