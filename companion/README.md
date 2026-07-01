# @hauler-helper/companion — Mission Mate

The optional local companion (MISSION_MATE_PLAN.md, Phase 2). It does a real
OS-level tail of the Star Citizen `Game.log`, parses each new line with
[`@hauler-helper/log-parser`](../log-parser), and pushes mission lifecycle events
to Supabase Realtime — the authoritative accept/abandon/complete/fail the web app
can't get on its own. **Read-only**: it never touches the game client.

Windows-first, Linux/Wine-compatible, no macOS. Runs under `tsx` today;
Bun-compiles to a single binary later (Phase 5).

## Run it

```bash
# Watch your live log and just print events — no account needed:
npx tsx companion/src/cli.ts --console

# One-shot parse a specific file (e.g. the committed sample):
npx tsx companion/src/cli.ts --console --replay --once --log Game.log

# Push to Supabase (after `login` + creds, see below):
npx tsx companion/src/cli.ts
```

`--help` lists every flag (`--log`, `--channel`, `--replay`, `--once`, `--console`).

## Auth (paste-token, §13)

Web auth is Discord-OAuth only, so the companion uses a pasted session rather
than a headless OAuth flow:

1. In HaulerHelper (signed in): DevTools → Application → Local Storage → copy the
   value of `haulerHelperAuth` and save it to a file (e.g. `token.json`). A real
   session is larger than a terminal's line limit, so it must come from a file
   or pipe — not a typed prompt.
2. `npx tsx companion/src/cli.ts login --file ./token.json` (or
   `... login < token.json`). The access + refresh tokens are stored in the OS
   config dir (`~/.config/mission-mate` / `%APPDATA%\mission-mate`, mode 0600);
   delete the temp file afterward.

Supabase project URL + anon key come from config (`supabaseUrl` /
`supabaseAnonKey`) or env (`SUPABASE_URL` / `SUPABASE_ANON_KEY`, `VITE_`-prefixed
also accepted). With a session **and** creds present, the watcher pushes to
Supabase; otherwise it falls back to console mode.

## Standalone binary (Phase 5)

Bun cross-compiles the whole thing — parser + supabase-js bundled — into a
single self-contained executable per OS. **No Node/Bun needed on the player's
machine.** Requires Bun ≥ 1.1 on the build machine.

```bash
npm run build -w @hauler-helper/companion     # both targets → companion/dist/
# or individually:
bun run build:linux     # → dist/mission-mate-linux
bun run build:windows   # → dist/mission-mate-windows.exe  (cross-compiles from any OS)
```

`dist/` is gitignored (each binary embeds the ~90 MB Bun runtime — ship via
GitHub Releases, not the repo).

### Running the binary (no toolchain required)

**Windows** (`mission-mate-windows.exe`):
1. Unsigned for now, so SmartScreen warns on first launch → **More info → Run
   anyway**. (Code-signing is deferred — see below.)
2. From a terminal in the download folder:
   ```
   mission-mate-windows.exe login --file token.json
   mission-mate-windows.exe            # watch + push
   ```

**Linux** (`mission-mate-linux`):
```bash
chmod +x mission-mate-linux
./mission-mate-linux login --file token.json
./mission-mate-linux                   # watch + push
```

`--help`, log-path auto-discovery, and the paste-token flow are identical to the
`tsx` invocation above.

## Architecture

- **tail.ts** — `planRead` (pure size→range decision, §5 truncation/rotation) +
  `LogTailer` (byte-offset reads + a remainder buffer so a mid-line poll never
  splits or drops an event).
- **discover.ts** — `candidateLogPaths` (pure, per-platform/channel) +
  `discoverLogPath`. The one real platform divergence lives here.
- **sink.ts / supabase-sink.ts** — `EventSink` abstraction. `ConsoleSink` prints;
  `SupabaseSink` writes the append-only `mission_log_events` fact stream and
  upserts `companion_status` presence. Auth lives behind the sink.
- **watch.ts** — the platform-agnostic poll loop (tail → parse → emit + heartbeat).
- **config.ts** — paste-token storage + extraction.

## Database

The companion writes to the HaulerHelper Supabase project (`mission_log_events`
+ `companion_status`, RLS-scoped to the signed-in user). That schema is owned and
provisioned by the HaulerHelper backend — companion users don't set anything up;
they just sign in.

## Out of scope (later phases)

Web-side correlation / OCR reconciliation / per-mission UI (Phase 3–4) ship in
the web app. Still deferred within Phase 5: **code-signing / notarization** (the
Windows binary is currently unsigned → SmartScreen "Run anyway"; macOS is not a
target) and an optional tray/GUI. This package is just: tail → parse → push.

## Develop

```
npm test -w @hauler-helper/companion   # or `npm test` from the repo root
```
