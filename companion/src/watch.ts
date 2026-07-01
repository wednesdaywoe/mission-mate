/**
 * The watch loop: poll the tail on a timer, parse each new line, push parsed
 * events to the sink, and heartbeat for presence. Platform-agnostic — all the
 * OS divergence is upstream in discover.ts; everything here is the same on
 * Windows and Linux (MISSION_MATE_PLAN §5a).
 */

import { parseLine } from '@hauler-helper/log-parser';
import { LogTailer } from './tail.ts';
import type { EventSink, HeartbeatStatus } from './sink.ts';

export interface WatchOpts {
  logPath: string;
  channel: string;
  mmVersion: string;
  /** File poll cadence (spec §4: 2–5s is trivially cheap). */
  pollMs?: number;
  /** Presence heartbeat cadence. */
  heartbeatMs?: number;
  /** Parse the existing file from the start instead of only new events. */
  replay?: boolean;
  /** Do a single poll then return (for tests / one-shot replay). */
  once?: boolean;
  signal?: AbortSignal;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export async function watch(sink: EventSink, opts: WatchOpts): Promise<void> {
  const pollMs = opts.pollMs ?? 2000;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const status: HeartbeatStatus = {
    logPath: opts.logPath,
    scChannel: opts.channel,
    mmVersion: opts.mmVersion,
  };

  const tailer = new LogTailer(opts.logPath);
  if (!opts.replay) await tailer.seekToEnd();

  await sink.heartbeat(status);
  let lastHeartbeat = Date.now();

  do {
    const { lines, reset } = await tailer.poll();
    if (reset) {
      console.error('[watch] log truncated/rotated — re-reading from start');
    }
    for (const line of lines) {
      const event = parseLine(line);
      if (event) await sink.emit(event);
    }

    if (opts.once) break;

    const now = Date.now();
    if (now - lastHeartbeat >= heartbeatMs) {
      await sink.heartbeat(status);
      lastHeartbeat = now;
    }
    await delay(pollMs, opts.signal);
  } while (!opts.signal?.aborted);
}
