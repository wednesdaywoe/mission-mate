import { describe, it, expect } from 'vitest';
import { parseLog, reconstructMissions, parseContractName } from '../src/index.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GAME_LOG = readFileSync(
  fileURLToPath(new URL('../../Game.log', import.meta.url)),
  'utf8',
);

describe('reconstructMissions — committed Game.log', () => {
  const missions = reconstructMissions(parseLog(GAME_LOG));

  it('reconstructs all 7 missions, every one completed', () => {
    expect(missions).toHaveLength(7);
    expect(missions.every((m) => m.status === 'completed')).toBe(true);
  });

  it('each mission has title, giver, def id, and the §7.2 leg structure', () => {
    for (const m of missions) {
      expect(m.title).toBe('Rookie Rank - Extra Small Cargo Haul');
      expect(m.generatorName).toBe('Covalex_Hauling');
      expect(m.contractDefinitionId).toMatch(/^[0-9a-f-]{36}$/);
      // SingleToMulti2 emits 4 objectives (pickup_0/1 + dropoff_0/1 — one
      // pickup-confirm per destination, GAME_LOG_SPEC §7.2), but only 3 have a
      // CreateMarker line; pickup_1 is objective-only, so it carries no position.
      expect(m.legs).toHaveLength(4);
      expect(m.legs.filter((l) => l.legKind === 'pickup')).toHaveLength(2);
      expect(m.legs.filter((l) => l.legKind === 'dropoff')).toHaveLength(2);
      const withMarker = m.legs.filter((l) => !Number.isNaN(l.position.x));
      expect(withMarker).toHaveLength(3);
    }
  });

  it('correlates objective progress onto legs', () => {
    const withState = missions.flatMap((m) => m.legs).filter((l) => l.state);
    // Every leg receives a state from ObjectiveUpserted (4 legs × 7 missions).
    expect(withState).toHaveLength(28);
    // Almost all complete; one known quirk — mission 5d4969cd's dropoff_1 never
    // gets a final COMPLETED upsert yet EndMission still reports Complete, so a
    // leg's terminal state is not a reliable completion signal — EndMission is.
    const completed = withState.filter((l) => l.state === 'completed');
    expect(completed.length).toBe(27);
  });

  it('the Aluminium mission resolves to its known def and drop-off coords', () => {
    const m = missions.find((x) => x.missionId.startsWith('3af45943'))!;
    expect(m.contract).toContain('Aluminium');
    expect(m.contractDefinitionId).toBe('05b77939-c3b0-4c2e-bb7e-77379f548ea6');
    // Greycat Complex-A drop-off from MISSION_MATE_LOCATIONS.seed.json.
    const greycat = m.legs.find((l) => Math.abs(l.position.x - -423347.34) < 1);
    expect(greycat).toBeDefined();
    expect(greycat!.legKind).toBe('dropoff');
  });
});

describe('parseContractName', () => {
  it('decodes structure, region, body, grade, and cargo tokens', () => {
    const p = parseContractName(
      'HaulCargo_SingleToMulti2_RefinedOre_Aluminium_Stanton4_SmallGrade',
    )!;
    expect(p.family).toBe('HaulCargo');
    expect(p.structure).toBe('SingleToMulti2');
    expect(p.dropoffCount).toBe(2);
    expect(p.region).toBe('Stanton4');
    expect(p.body).toBe('microTech');
    expect(p.grade).toBe('SmallGrade');
    expect(p.cargoTokens).toEqual(['RefinedOre', 'Aluminium']);
  });

  it('handles non-SingleToMulti structures without a drop-off count', () => {
    const p = parseContractName('HaulCargo_AToB_Processed_Mixed_Stanton4_SmallGrade')!;
    expect(p.dropoffCount).toBeNull();
    expect(p.structure).toBe('AToB');
    expect(p.region).toBe('Stanton4');
  });

  it('returns null for empty input', () => {
    expect(parseContractName('')).toBeNull();
  });
});
