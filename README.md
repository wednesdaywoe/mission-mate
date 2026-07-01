# Mission Mate

The open-source companion for **[HaulerHelper](https://sc-haulerhelper.com)**. It
reads your Star Citizen `Game.log` **locally** and streams mission lifecycle
events — accepted / progressed / completed — to your HaulerHelper account, so the
web app can track missions, correlate them to your scans, and fix OCR misreads.

- **Read-only.** It only tails the log file the game itself writes. No memory
  reading, no injection, nothing that touches the game client.
- **Opt-in and optional.** HaulerHelper works fine without it.
- **Open-source** for transparency. Don't download Mission Mate ANYWHERE other than this repo. (linked from **sc-haulerhelper.com**).

## Download

Grab the desktop app from the [**latest release**](../../releases/latest):

- **Windows** — `mission-mate-setup.exe`
- **Linux** — `mission-mate.AppImage` (portable), or `.deb` / `.rpm`

Launch it, sign in with your HaulerHelper account, and leave it running while you
play. (macOS isn't supported)

## What's inside

| Package | Role |
|---|---|
| [`log-parser/`](log-parser) | Pure `Game.log` → events parser. No I/O; unit-tested. |
| [`companion/`](companion) | Headless CLI: tail + log-path discovery + Supabase push. Compiles to a single binary. |
| [`companion-desktop/`](companion-desktop) | Tauri desktop app — a window that runs the companion as a sidecar (no terminal). |

The desktop app is the user-facing product; the companion binary is the engine it
runs. The parser is shared.

## Build from source

Prereqs: **Node**, **Bun ≥ 1.1**, **Rust** + cargo, and the platform webview
(Linux: `webkit2gtk-4.1`). Then:

```bash
npm install
npm test                                    # parser + companion tests
bun run build -w @hauler-helper/companion   # build the sidecar binaries
npm run build -w @hauler-helper/companion-desktop   # build the desktop installers
```

Installers land in `companion-desktop/src-tauri/target/release/bundle/`.
Releases are built automatically by [CI](.github/workflows/release.yml) on each
`v*` tag (Linux + Windows). See [`companion-desktop/README.md`](companion-desktop/README.md)
for details.

## License

[MIT](LICENSE).
