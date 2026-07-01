import { describe, it, expect } from 'vitest';
import { parseLine, parseLog } from '../src/index.ts';
import type {
  AcceptEvent,
  EndEvent,
  MarkerEvent,
  ObjectiveEvent,
} from '../src/index.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The committed real LIVE capture lives at the repo root (GAME_LOG_SPEC §8 run).
const GAME_LOG = readFileSync(
  fileURLToPath(new URL('../../Game.log', import.meta.url)),
  'utf8',
);

describe('parseLine — single events', () => {
  it('parses an accept event and trims the title', () => {
    const line =
      '<2026-06-29T22:42:54.064Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Accepted:  Rookie Rank - Extra Small Cargo Haul : " [4] to queue. New queue size: 5, MissionId: [3af45943-4580-483c-9f6c-1d7006eb5e66], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]';
    const ev = parseLine(line) as AcceptEvent;
    expect(ev?.type).toBe('accept');
    expect(ev.missionId).toBe('3af45943-4580-483c-9f6c-1d7006eb5e66');
    expect(ev.title).toBe('Rookie Rank - Extra Small Cargo Haul');
    expect(ev.timestamp).toBe('2026-06-29T22:42:54.064Z');
  });

  it('skips the bare quoted "Contract Accepted" echo (no MissionId)', () => {
    const echo =
      '<2026-06-29T22:42:54.064Z>    "Contract Accepted:  Rookie Rank - Extra Small Cargo Haul : " [4]';
    expect(parseLine(echo)).toBeNull();
  });

  it('parses a CreateMarker with position, leg kind/index, and def id', () => {
    const line =
      '<2026-06-29T22:42:54.060Z> [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [3af45943-4580-483c-9f6c-1d7006eb5e66], generator name [Covalex_Hauling], contract [HaulCargo_SingleToMulti2_RefinedOre_Aluminium_Stanton4_SmallGrade], contractDefinitionId[05b77939-c3b0-4c2e-bb7e-77379f548ea6], objectiveId [dropoff_2c480515-accc-4f08-8943-7dd18e6f18ed_1], markerEntityId [1280], zoneHostId [628147965116], position [x: -423347.340000, y: -141168.750000, z: -895144.870000] [Team_MissionFeatures][Missions]';
    const ev = parseLine(line) as MarkerEvent;
    expect(ev?.type).toBe('marker');
    expect(ev.generatorName).toBe('Covalex_Hauling');
    expect(ev.contract).toBe(
      'HaulCargo_SingleToMulti2_RefinedOre_Aluminium_Stanton4_SmallGrade',
    );
    expect(ev.contractDefinitionId).toBe('05b77939-c3b0-4c2e-bb7e-77379f548ea6');
    expect(ev.legKind).toBe('dropoff');
    expect(ev.legIndex).toBe(1);
    expect(ev.zoneHostId).toBe('628147965116');
    expect(ev.position.x).toBeCloseTo(-423347.34, 2);
    expect(ev.position.z).toBeCloseTo(-895144.87, 2);
  });

  it('parses an ObjectiveUpserted progress event', () => {
    const line =
      '<2026-06-29T23:45:07.872Z> [Notice] <ObjectiveUpserted> Received ObjectiveUpserted push message for: mission_id 5d4969cd-cce3-4af7-a05e-bf75d1d939a8 - objective_id dropoff_3f53ceb8-1c97-445d-9ce9-7d528e36e5f5_1 - state MISSION_OBJECTIVE_STATE_INPROGRESS - created 0 - flags=ShowInLog| [Team_GameServices][Missions]';
    const ev = parseLine(line) as ObjectiveEvent;
    expect(ev?.type).toBe('objective');
    expect(ev.missionId).toBe('5d4969cd-cce3-4af7-a05e-bf75d1d939a8');
    expect(ev.legKind).toBe('dropoff');
    expect(ev.legIndex).toBe(1);
    expect(ev.state).toBe('inprogress');
    expect(ev.rawState).toBe('MISSION_OBJECTIVE_STATE_INPROGRESS');
  });

  it('parses an EndMission with completion type and reason', () => {
    const line =
      '<2026-06-29T23:32:53.457Z> [Notice] <EndMission> Ending mission for player. MissionId[c4d6a452-3997-419a-86c9-588dc76f1025] Player[TestPilot] PlayerId[100000000000] CompletionType[Complete] Reason[Mission Ended] [Team_MissionFeatures][Missions]';
    const ev = parseLine(line) as EndEvent;
    expect(ev?.type).toBe('end');
    expect(ev.missionId).toBe('c4d6a452-3997-419a-86c9-588dc76f1025');
    expect(ev.player).toBe('TestPilot');
    expect(ev.completionType).toBe('Complete');
    expect(ev.reason).toBe('Mission Ended');
  });

  it('parses the Log started header', () => {
    const line = '<2026-06-29T22:29:13.778Z> Log started on Mon Jun 29 22:29:13 2026';
    expect(parseLine(line)?.type).toBe('log-started');
  });

  it('returns null for non-mission noise and malformed lines', () => {
    expect(parseLine('not a log line at all')).toBeNull();
    expect(parseLine('')).toBeNull();
    expect(parseLine('<2026-06-29T22:29:13.778Z> [Notice] <SomethingElse> blah')).toBeNull();
  });
});

describe('parseLog — full committed Game.log (7-mission run)', () => {
  const events = parseLog(GAME_LOG);
  const count = (t: string) => events.filter((e) => e.type === t).length;

  it('extracts the exact ground-truth event counts', () => {
    // Verified via grep against the committed log.
    expect(count('accept')).toBe(7);
    expect(count('marker')).toBe(21);
    expect(count('objective')).toBe(28);
    expect(count('end')).toBe(7);
    expect(count('log-started')).toBe(1);
  });

  it('all 7 missions complete successfully', () => {
    const ends = events.filter((e): e is EndEvent => e.type === 'end');
    expect(ends.every((e) => e.completionType === 'Complete')).toBe(true);
    expect(ends.every((e) => e.reason === 'Mission Ended')).toBe(true);
  });

  it('finds exactly 7 distinct accepted MissionIds', () => {
    const ids = new Set(
      events.filter((e): e is AcceptEvent => e.type === 'accept').map((e) => e.missionId),
    );
    expect(ids.size).toBe(7);
  });
});
