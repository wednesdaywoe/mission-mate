/**
 * Correlate a flat event stream into per-mission records, keyed by the
 * MissionId GUID (the join across accept -> markers -> objectives -> end,
 * GAME_LOG_SPEC §3). Pure: same events in -> same records out.
 *
 * This is the smallest useful aggregation. It does NOT touch OCR, scunpacked
 * defs, or the location map — those joins happen downstream in the web app.
 */

import type { LegKind, LogEvent, ObjectiveState } from './types.ts';

export type MissionStatus =
  | 'accepted'
  | 'in-progress'
  | 'completed'
  | 'abandoned'
  | 'failed'
  | 'ended';

export interface MissionLeg {
  objectiveId: string;
  legKind: LegKind;
  legIndex: number;
  position: { x: number; y: number; z: number };
  markerEntityId: string;
  zoneHostId: string;
  /** Latest objective state seen for this leg, if any ObjectiveUpserted arrived. */
  state?: ObjectiveState;
}

export interface MissionRecord {
  missionId: string;
  title?: string;
  acceptedAt?: string;
  generatorName?: string;
  contract?: string;
  contractDefinitionId?: string;
  /** Legs, keyed+sorted by `${legKind}_${legIndex}`. */
  legs: MissionLeg[];
  outcome?: {
    completionType: string;
    reason: string;
    endedAt: string;
  };
  status: MissionStatus;
}

function legKey(kind: LegKind, index: number): string {
  return `${kind}_${index}`;
}

function statusFromCompletion(completionType: string): MissionStatus {
  switch (completionType.toLowerCase()) {
    case 'complete':
      return 'completed';
    case 'abandon':
      return 'abandoned';
    case 'fail':
    case 'failed':
      return 'failed';
    default:
      return 'ended';
  }
}

/**
 * Reconstruct mission records from an event list. Input order is preserved for
 * first-seen fields; for legs and objective state, last write wins. Records are
 * returned in order of first appearance.
 */
export function reconstructMissions(events: LogEvent[]): MissionRecord[] {
  const byId = new Map<string, MissionRecord>();
  // Per-mission leg index so we can update a leg's objective state in place.
  const legIndexById = new Map<string, Map<string, MissionLeg>>();

  const ensure = (missionId: string): MissionRecord => {
    let rec = byId.get(missionId);
    if (!rec) {
      rec = { missionId, legs: [], status: 'accepted' };
      byId.set(missionId, rec);
      legIndexById.set(missionId, new Map());
    }
    return rec;
  };

  for (const ev of events) {
    if (ev.type === 'log-started') continue;
    const rec = ensure(ev.missionId);
    const legs = legIndexById.get(ev.missionId)!;

    switch (ev.type) {
      case 'accept': {
        rec.title ??= ev.title;
        rec.acceptedAt ??= ev.timestamp;
        break;
      }
      case 'marker': {
        rec.generatorName ??= ev.generatorName;
        rec.contract ??= ev.contract;
        rec.contractDefinitionId ??= ev.contractDefinitionId;
        const key = legKey(ev.legKind, ev.legIndex);
        let leg = legs.get(key);
        if (!leg) {
          leg = {
            objectiveId: ev.objectiveId,
            legKind: ev.legKind,
            legIndex: ev.legIndex,
            position: ev.position,
            markerEntityId: ev.markerEntityId,
            zoneHostId: ev.zoneHostId,
          };
          legs.set(key, leg);
          rec.legs.push(leg);
        }
        break;
      }
      case 'objective': {
        const key = legKey(ev.legKind, ev.legIndex);
        let leg = legs.get(key);
        if (!leg) {
          // Objective state can arrive for a leg whose marker we didn't capture.
          leg = {
            objectiveId: ev.objectiveId,
            legKind: ev.legKind,
            legIndex: ev.legIndex,
            position: { x: NaN, y: NaN, z: NaN },
            markerEntityId: '',
            zoneHostId: '',
          };
          legs.set(key, leg);
          rec.legs.push(leg);
        }
        leg.state = ev.state;
        if (rec.status === 'accepted') rec.status = 'in-progress';
        break;
      }
      case 'end': {
        rec.outcome = {
          completionType: ev.completionType,
          reason: ev.reason,
          endedAt: ev.timestamp,
        };
        rec.status = statusFromCompletion(ev.completionType);
        break;
      }
    }
  }

  for (const rec of byId.values()) {
    rec.legs.sort(
      (a, b) =>
        a.legKind.localeCompare(b.legKind) || a.legIndex - b.legIndex,
    );
  }

  return [...byId.values()];
}
