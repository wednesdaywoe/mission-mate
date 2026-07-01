# @hauler-helper/companion-desktop — Mission Mate (desktop app)

The no-terminal desktop version of the companion. A small **Tauri** window that
runs the compiled [`@hauler-helper/companion`](../companion) binary as a
**sidecar** — so the tail/parse/push core ships unchanged, and the app adds a
window, GUI sign-in (paste a token into a field — no terminal, no char limit),
and a live status/activity view.

```
┌─ Mission Mate ───────────────┐
│ ● Watching Game.log          │
│  paste haulerHelperAuth …    │
│  [ Connect ]  [ Stop ]       │
│  Activity ────────────────   │
│  Signed in.                  │
│  Watching LIVE: …/Game.log   │
│  ▶ ACCEPT 3af45943 "Rookie…" │
└──────────────────────────────┘
```

## How it works

- **Rust** ([src-tauri/src/lib.rs](src-tauri/src/lib.rs)) owns the sidecar:
  `connect` writes the pasted session to a temp file and runs the sidecar's
  `login --file` (reusing its tolerant token parser), then spawns it in watch
  mode and streams stdout/stderr to the window. `stop` kills it. Supabase
  publishable creds are passed to the sidecar via env.
- **UI** ([ui/](ui/)) is a static page using the global Tauri API (no bundler).
- The companion binary is bundled via `bundle.externalBin` and resolved next to
  the app at runtime.

## Build it

Prereqs: **Rust** + **cargo**, the platform webview (Linux: `webkit2gtk-4.1`),
**Bun ≥ 1.1** (to build the sidecar), and Node (for the Tauri CLI). `npm install`
at the repo root installs the Tauri CLI.

```bash
# 1. Build the companion sidecar binaries:
bun run build -w @hauler-helper/companion        # → companion/dist/*

# 2. Build the desktop app (sync-sidecars copies them into src-tauri/binaries/):
npm run build -w @hauler-helper/companion-desktop
#   or, while iterating, a live window:
npm run dev   -w @hauler-helper/companion-desktop
```

Output (Linux): `src-tauri/target/release/bundle/` → `.deb`, `.rpm`, and
`.AppImage` (the AppImage step downloads a linuxdeploy helper, so it needs
network). `src-tauri/binaries/` is gitignored — regenerate with
`npm run sidecars` (it reads the host triple from `rustc` and copies from
`companion/dist`).

### Windows

Tauri builds the app **on the target OS** — produce the Windows `.exe`/`.msi`
on a Windows machine (or CI with a `windows` runner). The Windows sidecar
(`mission-mate-windows.exe`, cross-compiled by Bun) is already produced by step 1
and `sync-sidecars` places it as `mission-mate-x86_64-pc-windows-msvc.exe`, so a
Windows build host just needs steps 1–2. macOS is not a target.

## Use it

1. Install the package (`.deb`/`.rpm`/`.AppImage`, or the Windows installer).
2. Launch **Mission Mate** (it's a normal app — no terminal).
3. In HaulerHelper (signed in): DevTools → Application → Local Storage → copy
   `haulerHelperAuth`, paste it into the window, click **Connect**.
4. Launch Star Citizen — events stream into HaulerHelper.

## Deferred (Phase 5 polish)

Code-signing (Windows/macOS), auto-update, one-click "Sign in with Discord"
(browser OAuth + loopback redirect) to replace the paste-token step, and a
minimize-to-tray option.
