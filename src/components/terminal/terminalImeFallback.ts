type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type PendingInput = {
  data: string;
  delivered: boolean;
  timer: TimerHandle;
};

type RecentData = {
  data: string;
  at: number;
};

const FALLBACK_DELAY_MS = 32;
const RECENT_DATA_WINDOW_MS = 100;
const COMMITTED_INPUT_TYPES = new Set(["insertText", "insertFromComposition"]);

/**
 * Repairs WebKit IME input shapes that update xterm's hidden textarea without
 * producing onData. Normal xterm input remains authoritative and consumes the
 * matching pending fallback before it can send a duplicate.
 */
export class TerminalImeFallback {
  private readonly pending: PendingInput[] = [];
  private readonly recent: RecentData[] = [];

  constructor(
    private readonly deliver: (data: string) => void,
    private readonly schedule: (
      task: () => void,
      delayMs: number,
    ) => TimerHandle = globalThis.setTimeout,
    private readonly cancel: (timer: TimerHandle) => void = globalThis.clearTimeout,
    private readonly now: () => number = Date.now,
  ) {}

  recordTerminalData(data: string) {
    const pending = this.pending.find(
      (candidate) => !candidate.delivered && candidate.data === data,
    );
    if (pending) {
      pending.delivered = true;
      return;
    }

    this.trimRecent();
    this.recent.push({ data, at: this.now() });
  }

  recordInput(data: string | null, inputType: string, isComposing = false) {
    if (isComposing || !data || !COMMITTED_INPUT_TYPES.has(inputType)) return;

    this.trimRecent();
    const recentIndex = this.recent.findIndex(
      (candidate) => candidate.data === data,
    );
    if (recentIndex >= 0) {
      this.recent.splice(recentIndex, 1);
      return;
    }

    const pending = {
      data,
      delivered: false,
      timer: undefined as unknown as TimerHandle,
    };
    pending.timer = this.schedule(() => {
      const index = this.pending.indexOf(pending);
      if (index >= 0) this.pending.splice(index, 1);
      if (!pending.delivered) this.deliver(pending.data);
    }, FALLBACK_DELAY_MS);
    this.pending.push(pending);
  }

  dispose() {
    for (const pending of this.pending) this.cancel(pending.timer);
    this.pending.length = 0;
    this.recent.length = 0;
  }

  private trimRecent() {
    const cutoff = this.now() - RECENT_DATA_WINDOW_MS;
    while (this.recent[0]?.at < cutoff) this.recent.shift();
  }
}
