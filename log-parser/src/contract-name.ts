/**
 * Best-effort decode of a contract DebugName, e.g.
 *   HaulCargo_SingleToMulti2_RefinedOre_Aluminium_Stanton4_SmallGrade
 *
 * This recovers the STRUCTURAL tokens that are unambiguous (drop-off count,
 * region, grade). Commodity decoding is deliberately left raw: the cargo
 * segment is partial and `Mixed` bundles several commodities — mapping those
 * tokens to the app's COMMODITIES list is a separate, confidence-scored data
 * task (MISSION_MATE_PLAN §6), not something to fake here.
 */

/** Stanton<N> region suffix -> body display name (extend as observed). */
const STANTON_BODY: Record<string, string> = {
  Stanton1: 'Hurston',
  Stanton2: 'Crusader',
  Stanton3: 'ArcCorp',
  Stanton4: 'microTech',
};

export interface ParsedContractName {
  /** Leading family token, e.g. "HaulCargo". */
  family: string;
  /** Raw structure token, e.g. "SingleToMulti2" or "AToB". */
  structure: string;
  /** Drop-off count from `SingleToMulti<N>` (GAME_LOG_SPEC §8); null for other structures. */
  dropoffCount: number | null;
  /** Region token, e.g. "Stanton4". */
  region: string | null;
  /** Body display name resolved from the region token, e.g. "microTech". */
  body: string | null;
  /** Grade token, e.g. "SmallGrade". */
  grade: string | null;
  /** The middle cargo tokens, raw and unmapped (e.g. ["RefinedOre", "Aluminium"]). */
  cargoTokens: string[];
}

/**
 * Parse a contract DebugName into its structural parts. Returns null only for
 * empty input; otherwise fills what it can and leaves the rest null/raw.
 */
export function parseContractName(name: string): ParsedContractName | null {
  if (!name) return null;
  const tokens = name.split('_');

  const family = tokens[0] ?? '';
  const structure = tokens[1] ?? '';

  const multiMatch = /^SingleToMulti(\d+)$/.exec(structure);
  const dropoffCount = multiMatch ? Number(multiMatch[1]) : null;

  const regionIdx = tokens.findIndex((t) => /^Stanton\d+$/.test(t));
  const region = regionIdx >= 0 ? tokens[regionIdx] : null;
  const body = region ? STANTON_BODY[region] ?? null : null;

  const gradeIdx = tokens.findIndex((t) => /Grade$/.test(t));
  const grade = gradeIdx >= 0 ? tokens[gradeIdx] : null;

  // Cargo tokens are everything between the structure token and the region
  // token (or the grade token, whichever bounds the middle).
  const start = 2;
  const endCandidates = [regionIdx, gradeIdx].filter((i) => i > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : tokens.length;
  const cargoTokens = tokens.slice(start, end);

  return { family, structure, dropoffCount, region, body, grade, cargoTokens };
}
