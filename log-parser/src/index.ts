/**
 * @hauler-helper/log-parser
 *
 * Pure Star Citizen Game.log parser for Mission Mate. No I/O — `string -> events`
 * (parse.ts) and `events -> per-mission records` (aggregate.ts). The companion
 * binary supplies the file tail; the web app supplies correlation/OCR. This
 * package is the shared core both reuse.
 *
 * See GAME_LOG_SPEC.md (line format) and MISSION_MATE_PLAN.md §11 (Phase 1).
 */

export * from './types.ts';
export { parseLine, parseLog } from './parse.ts';
export { reconstructMissions } from './aggregate.ts';
export type {
  MissionRecord,
  MissionLeg,
  MissionStatus,
} from './aggregate.ts';
export { parseContractName } from './contract-name.ts';
export type { ParsedContractName } from './contract-name.ts';
