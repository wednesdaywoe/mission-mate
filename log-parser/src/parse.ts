/**
 * Pure Game.log -> events parser.
 *
 * `parseLine` recognizes one line; `parseLog` maps an entire file. No I/O,
 * no state, no correlation. Lines we don't recognize return null and are
 * dropped — an unknown event must never throw (fail-soft, MISSION_MATE_PLAN §12).
 *
 * Filtering is by EVENT NAME, never severity: some real mission events log as
 * [Error] (GAME_LOG_SPEC §1).
 */

import type {
  AcceptEvent,
  EndEvent,
  LegKind,
  LogEvent,
  LogStartedEvent,
  MarkerEvent,
  ObjectiveEvent,
  ObjectiveState,
  Vec3,
} from './types.ts';

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Leading `<ISO-8601-UTC>` timestamp. */
const TIMESTAMP_RE = /^<([^>]+)>/;

/** objectiveId / objective_id shape: `<pickup|dropoff>_<guid>_<index>`. */
const OBJECTIVE_ID_RE = new RegExp(`^(pickup|dropoff)_${GUID}_(\\d+)$`);

const ACCEPT_RE = new RegExp(
  `Contract Accepted:\\s*([^"]*?)\\s*"[\\s\\S]*?MissionId:\\s*\\[(${GUID})\\]`,
);

const MARKER_RE = new RegExp(
  [
    `missionId \\[(${GUID})\\]`,
    `generator name \\[([^\\]]*)\\]`,
    `contract \\[([^\\]]*)\\]`,
    `contractDefinitionId\\[(${GUID})\\]`,
    `objectiveId \\[([^\\]]*)\\]`,
    `markerEntityId \\[([^\\]]*)\\]`,
    `zoneHostId \\[([^\\]]*)\\]`,
    `position \\[x:\\s*(-?[\\d.]+),\\s*y:\\s*(-?[\\d.]+),\\s*z:\\s*(-?[\\d.]+)\\]`,
  ].join('[\\s\\S]*?'),
);

const OBJECTIVE_RE = new RegExp(
  `mission_id (${GUID})[\\s\\S]*?objective_id (\\S+)[\\s\\S]*?state (MISSION_OBJECTIVE_STATE_\\w+)`,
);

const END_RE = new RegExp(
  [
    `MissionId\\[(${GUID})\\]`,
    `Player\\[([^\\]]*)\\]`,
    `PlayerId\\[([^\\]]*)\\]`,
    `CompletionType\\[([^\\]]*)\\]`,
    `Reason\\[([^\\]]*)\\]`,
  ].join('[\\s\\S]*?'),
);

function timestampOf(line: string): string | null {
  const m = TIMESTAMP_RE.exec(line);
  return m ? m[1] : null;
}

/** Split a raw `<pickup|dropoff>_<guid>_<n>` id into its kind + index. */
function splitObjectiveId(id: string): { legKind: LegKind; legIndex: number } | null {
  const m = OBJECTIVE_ID_RE.exec(id);
  if (!m) return null;
  return { legKind: m[1] as LegKind, legIndex: Number(m[2]) };
}

function normalizeState(rawState: string): ObjectiveState {
  if (rawState.endsWith('_INPROGRESS')) return 'inprogress';
  if (rawState.endsWith('_COMPLETED')) return 'completed';
  return 'unknown';
}

function num(v: string): number {
  return Number(v);
}

/**
 * Parse a single log line into one event, or null if it is not a recognized
 * mission event. The timestamp gate means non-log noise can never match.
 */
export function parseLine(line: string): LogEvent | null {
  const timestamp = timestampOf(line);
  if (timestamp === null) return null;
  const raw = line;

  // Dispatch on the structured event name to keep each branch cheap and to
  // avoid running every regex against every line.
  if (line.includes('Log started on')) {
    return { type: 'log-started', timestamp, raw } satisfies LogStartedEvent;
  }

  if (line.includes('Contract Accepted:')) {
    const m = ACCEPT_RE.exec(line);
    if (!m) return null; // the bare quoted echoes have no MissionId — skip them
    const title = m[1].replace(/\s*:\s*$/, '').trim();
    return {
      type: 'accept',
      timestamp,
      raw,
      missionId: m[2],
      title,
    } satisfies AcceptEvent;
  }

  if (line.includes('CLocalMissionPhaseMarker::CreateMarker')) {
    const m = MARKER_RE.exec(line);
    if (!m) return null;
    const objectiveId = m[5];
    const split = splitObjectiveId(objectiveId);
    if (!split) return null;
    const position: Vec3 = { x: num(m[8]), y: num(m[9]), z: num(m[10]) };
    return {
      type: 'marker',
      timestamp,
      raw,
      missionId: m[1],
      generatorName: m[2],
      contract: m[3],
      contractDefinitionId: m[4],
      objectiveId,
      legKind: split.legKind,
      legIndex: split.legIndex,
      markerEntityId: m[6],
      zoneHostId: m[7],
      position,
    } satisfies MarkerEvent;
  }

  if (line.includes('ObjectiveUpserted')) {
    const m = OBJECTIVE_RE.exec(line);
    if (!m) return null;
    const objectiveId = m[2];
    const split = splitObjectiveId(objectiveId);
    if (!split) return null;
    const rawState = m[3];
    return {
      type: 'objective',
      timestamp,
      raw,
      missionId: m[1],
      objectiveId,
      legKind: split.legKind,
      legIndex: split.legIndex,
      state: normalizeState(rawState),
      rawState,
    } satisfies ObjectiveEvent;
  }

  if (line.includes('EndMission')) {
    const m = END_RE.exec(line);
    if (!m) return null;
    return {
      type: 'end',
      timestamp,
      raw,
      missionId: m[1],
      player: m[2],
      playerId: m[3],
      completionType: m[4],
      reason: m[5],
    } satisfies EndEvent;
  }

  return null;
}

/**
 * Parse a whole log (or an appended tail) into events, in file order.
 * Handles `\n` and `\r\n`. Safe to call on partial content — an incomplete
 * trailing line simply won't match.
 */
export function parseLog(text: string): LogEvent[] {
  const events: LogEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const event = parseLine(line);
    if (event) events.push(event);
  }
  return events;
}
