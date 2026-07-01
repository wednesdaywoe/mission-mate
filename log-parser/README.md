# @hauler-helper/log-parser

Pure parser for the Star Citizen `Game.log`, the shared core of **Mission Mate**
(MISSION_MATE_PLAN.md §11, Phase 1). No I/O, no state, no network — just
`string -> events` and `events -> per-mission records`. The companion binary
supplies the file tail; the web app supplies correlation/OCR. Both import this.

## API

```ts
import { parseLog, reconstructMissions, parseContractName } from '@hauler-helper/log-parser';

const events = parseLog(rawLogText);        // LogEvent[] in file order
const missions = reconstructMissions(events); // MissionRecord[] keyed by MissionId
const spec = parseContractName(events[0].contract); // structural decode (best-effort)
```

- `parseLine(line)` / `parseLog(text)` — recognize `accept`, `marker`,
  `objective`, `end`, `log-started`. Unknown lines return `null` (fail-soft).
  Filtering is by **event name, not severity** (GAME_LOG_SPEC §1).
- `reconstructMissions(events)` — correlate by the `MissionId` GUID into
  `{ title, generatorName, contractDefinitionId, legs[], outcome, status }`.
- `parseContractName(name)` — decode the structural tokens of a contract
  DebugName (drop-off count, region/body, grade). Commodity decoding is left raw
  on purpose (a separate confidence-scored task, MISSION_MATE_PLAN §6).

## What the tests pin down (committed `Game.log`, 7-mission run)

- Exactly **7 accept** (only lines carrying a real `MissionId`; the 46 bare
  quoted "Contract Accepted" echoes are skipped), **21 marker**, **28
  ObjectiveUpserted**, **7 end** (all `Complete`), **1 log header**.
- Each `SingleToMulti2` mission reconstructs to **4 legs** (`pickup_0/1` +
  `dropoff_0/1`, GAME_LOG_SPEC §7.2) but only **3** have a `CreateMarker`
  position — `pickup_1` is objective-only.
- **A leg's terminal objective state is not a reliable completion signal:**
  mission `5d4969cd`'s `dropoff_1` stays `inprogress` (no final COMPLETED
  upsert) yet `EndMission` reports `Complete`. Treat `EndMission` as
  authoritative for mission outcome.

## Out of scope (Phase 1)

File tailing / truncation handling (companion, Phase 2), Supabase, OCR
reconciliation, and the location/scunpacked joins all live elsewhere. This stays
a pure function so it's reusable and trivially testable.

## Develop

```
npm test            # from repo root, or `npm test -w @hauler-helper/log-parser`
npm run test:watch
```
