/**
 * Event model for the Star Citizen Game.log parser.
 *
 * Each recognized log line maps to exactly one discriminated-union member.
 * The parser is pure: it never infers, correlates, or reaches for external
 * data here — it only reports what a single line literally said. Correlation
 * across lines (accept -> markers -> objectives -> end) lives in aggregate.ts.
 *
 * See GAME_LOG_SPEC.md (§2-§3) for the source line shapes.
 */

/** A planet/zone-local marker position, as emitted by CreateMarker (floats, metres). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Whether an objective leg is a cargo pickup or a drop-off. */
export type LegKind = 'pickup' | 'dropoff';

export type LogEventType =
  | 'accept'
  | 'marker'
  | 'objective'
  | 'end'
  | 'log-started';

interface BaseEvent {
  type: LogEventType;
  /** ISO-8601 UTC timestamp from the line's leading `<...>`. */
  timestamp: string;
  /** The verbatim source line (for debugging / future re-parse). */
  raw: string;
}

/**
 * `Contract Accepted` notification carrying a real MissionId.
 * The same notification is re-logged many times as the queue churns; only the
 * line that actually carries `MissionId: [<guid>]` becomes an accept event
 * (the bare quoted echoes are skipped).
 */
export interface AcceptEvent extends BaseEvent {
  type: 'accept';
  missionId: string;
  /** Display title, trimmed of the surrounding quotes/colons, e.g. "Rookie Rank - Extra Small Cargo Haul". */
  title: string;
}

/**
 * `CLocalMissionPhaseMarker::CreateMarker` — the data-rich per-objective line.
 * One per pickup/drop-off leg.
 */
export interface MarkerEvent extends BaseEvent {
  type: 'marker';
  missionId: string;
  /** Mission giver, e.g. "Covalex_Hauling". */
  generatorName: string;
  /** Internal contract DebugName, e.g. "HaulCargo_SingleToMulti2_RefinedOre_Aluminium_Stanton4_SmallGrade". */
  contract: string;
  /** GUID that is the scunpacked contract-definition filename (GAME_LOG_SPEC §10). */
  contractDefinitionId: string;
  /** Raw objectiveId, e.g. "dropoff_2c480515-...-_1". */
  objectiveId: string;
  legKind: LegKind;
  /** Trailing index of the objectiveId (the `_0` / `_1`), maps 1:1 to on-screen objective order. */
  legIndex: number;
  markerEntityId: string;
  /** Shared per-zone host id — NOT a per-location id (GAME_LOG_SPEC §8a). */
  zoneHostId: string;
  /** Zone-local marker position; resolve to a location by `position`, not zoneHostId. */
  position: Vec3;
}

/** Per-objective state transition from a push message. */
export type ObjectiveState = 'inprogress' | 'completed' | 'unknown';

/**
 * `ObjectiveUpserted` — live per-leg progress (INPROGRESS -> COMPLETED),
 * for both pickup and drop-off legs (GAME_LOG_SPEC §7.2).
 */
export interface ObjectiveEvent extends BaseEvent {
  type: 'objective';
  missionId: string;
  objectiveId: string;
  legKind: LegKind;
  legIndex: number;
  state: ObjectiveState;
  /** Raw `MISSION_OBJECTIVE_STATE_*` token, preserved for unrecognized states. */
  rawState: string;
}

/**
 * `EndMission` — the authoritative terminal event.
 * `completionType` observed: "Complete", "Abandon" (failure string still
 * unconfirmed — GAME_LOG_SPEC §7.1).
 */
export interface EndEvent extends BaseEvent {
  type: 'end';
  missionId: string;
  player: string;
  playerId: string;
  completionType: string;
  reason: string;
}

/** `Log started on ...` header — marks a fresh session (truncation/rotation point). */
export interface LogStartedEvent extends BaseEvent {
  type: 'log-started';
}

export type LogEvent =
  | AcceptEvent
  | MarkerEvent
  | ObjectiveEvent
  | EndEvent
  | LogStartedEvent;
