/**
 * Event sink abstraction. The watch loop produces parsed `LogEvent`s; a sink
 * decides what to do with them. This keeps the tail/parse core independent of
 * the destination, so the same loop drives either a local ConsoleSink (dev /
 * no-account) or the SupabaseSink (real push). Auth lives behind the sink.
 */

import type { LogEvent } from '@hauler-helper/log-parser';

/** Presence/heartbeat payload (mirrors the `companion_status` row, §8). */
export interface HeartbeatStatus {
  logPath: string;
  scChannel: string;
  mmVersion: string;
}

export interface EventSink {
  /** Persist / forward one parsed log event. */
  emit(event: LogEvent): Promise<void>;
  /** Liveness ping so HH can show "connected / last seen Ns ago" (§7a). */
  heartbeat(status: HeartbeatStatus): Promise<void>;
  /** Optional teardown (flush, close connections). */
  close(): Promise<void>;
}

const ICONS: Record<LogEvent['type'], string> = {
  accept: '▶ ACCEPT  ',
  marker: '· marker  ',
  objective: '◆ objective',
  end: '■ END     ',
  'log-started': '⟳ log-start',
};

/** Pretty one-line-per-event sink for `tsx` dev runs and no-account users. */
export class ConsoleSink implements EventSink {
  async emit(event: LogEvent): Promise<void> {
    const id =
      'missionId' in event ? ` ${event.missionId.slice(0, 8)}` : '';
    let detail = '';
    switch (event.type) {
      case 'accept':
        detail = ` "${event.title}"`;
        break;
      case 'marker':
        detail = ` ${event.legKind}_${event.legIndex} ${event.contract}`;
        break;
      case 'objective':
        detail = ` ${event.legKind}_${event.legIndex} → ${event.state}`;
        break;
      case 'end':
        detail = ` ${event.completionType} (${event.reason})`;
        break;
    }
    console.log(`${ICONS[event.type]}${id}${detail}`);
  }

  async heartbeat(status: HeartbeatStatus): Promise<void> {
    console.log(`   … watching ${status.scChannel} (${status.logPath})`);
  }

  async close(): Promise<void> {}
}
