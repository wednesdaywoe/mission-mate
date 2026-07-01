/**
 * Incremental log tailer — the I/O half of the companion (GAME_LOG_SPEC §5).
 *
 * The web app can't watch a file; the companion does a real OS-level tail. The
 * tricky parts the spec calls out:
 *   - the file is APPEND-ONLY during a session but TRUNCATED/ROTATED on every
 *     game launch — so a shrink means "re-read from 0", not "nothing new";
 *   - reads happen on a timer, so a poll routinely lands mid-line — we must NOT
 *     hand a half-written line to the parser and then lose its continuation.
 *
 * `planRead` is the pure decision (testable in isolation); `LogTailer` adds the
 * fs reads plus a remainder buffer so only COMPLETE lines are emitted.
 */

import { open, stat } from 'node:fs/promises';

export interface ReadPlan {
  /** File shrank since last read → game relaunched; re-read from the start. */
  reset: boolean;
  from: number;
  to: number;
}

/**
 * Decide the byte range to read given the bytes already consumed and the
 * current file size. Pure — no I/O.
 */
export function planRead(consumedBytes: number, currentSize: number): ReadPlan {
  if (currentSize < consumedBytes) {
    return { reset: true, from: 0, to: currentSize };
  }
  return { reset: false, from: consumedBytes, to: currentSize };
}

async function readRange(path: string, from: number, to: number): Promise<string> {
  if (to <= from) return '';
  const fh = await open(path, 'r');
  try {
    const length = to - from;
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, from);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

export interface PollResult {
  /** Complete lines (no trailing newline) appended since the last poll. */
  lines: string[];
  /** True when this poll detected a truncation/rotation and reset to offset 0. */
  reset: boolean;
}

/**
 * Stateful tailer over a single path. Call `poll()` on a timer; it returns the
 * complete lines that appeared since the previous call. A partial trailing line
 * is held back in an internal buffer until its newline arrives.
 */
export class LogTailer {
  private consumed = 0;
  private pending = '';

  constructor(private readonly path: string) {}

  /** Skip everything currently in the file (watch only new events going forward). */
  async seekToEnd(): Promise<void> {
    const { size } = await stat(this.path);
    this.consumed = size;
    this.pending = '';
  }

  async poll(): Promise<PollResult> {
    const { size } = await stat(this.path);
    const plan = planRead(this.consumed, size);
    if (plan.reset) this.pending = '';

    const chunk = await readRange(this.path, plan.from, plan.to);
    this.consumed = plan.to;

    if (chunk.length === 0) return { lines: [], reset: plan.reset };

    this.pending += chunk;
    const segments = this.pending.split('\n');
    // Last segment is the (possibly empty) incomplete remainder — keep buffering.
    this.pending = segments.pop() ?? '';
    const lines = segments.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
    return { lines, reset: plan.reset };
  }
}
