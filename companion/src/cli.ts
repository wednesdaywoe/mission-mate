#!/usr/bin/env node
/**
 * Mission Mate companion CLI.
 *
 *   mission-mate login         # paste your HH session token, store it
 *   mission-mate               # watch the log and push events
 *   mission-mate --console     # watch and just print (no account needed)
 *   mission-mate --replay --once --log ./Game.log   # one-shot parse a file
 *
 * Runs under `tsx` today; Bun-compiles to a single binary later (Phase 5).
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdin } from 'node:process';
import {
  candidateLogPaths,
  defaultDiscoverOpts,
  discoverLogPath,
  DEFAULT_CHANNEL,
  type ScChannel,
} from './discover.ts';
import {
  loadConfig,
  saveConfig,
  configPath,
  parsePastedSession,
} from './config.ts';
import { ConsoleSink, type EventSink } from './sink.ts';
import { SupabaseSink } from './supabase-sink.ts';
import { watch } from './watch.ts';

const MM_VERSION = '0.1.0';

interface Args {
  command: 'watch' | 'login' | 'print-config' | 'set-log' | 'help';
  logPath?: string;
  channel: ScChannel;
  replay: boolean;
  once: boolean;
  forceConsole: boolean;
  /** For `login`: read the session blob from this file instead of a prompt. */
  file?: string;
  /** For `set-log`: forget the saved path and go back to auto-discovery. */
  clear: boolean;
  /** Machine-readable `print-config` (the desktop shell parses this). */
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'watch',
    channel: DEFAULT_CHANNEL,
    replay: false,
    once: false,
    forceConsole: false,
    clear: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case 'login':
        args.command = 'login';
        break;
      case 'print-config':
        args.command = 'print-config';
        break;
      case 'set-log':
        args.command = 'set-log';
        // A bare path may follow (`set-log D:/.../Game.log`), which the
        // default branch below would otherwise reject as unknown.
        if (argv[i + 1] && !argv[i + 1].startsWith('--')) args.logPath = argv[++i];
        break;
      case '--clear':
        args.clear = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '-h':
      case '--help':
        args.command = 'help';
        break;
      case '--log':
        args.logPath = argv[++i];
        break;
      case '--file':
        args.file = argv[++i];
        break;
      case '--channel':
        args.channel = argv[++i] as ScChannel;
        break;
      case '--replay':
        args.replay = true;
        break;
      case '--once':
        args.once = true;
        break;
      case '--console':
        args.forceConsole = true;
        break;
      default:
        console.error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

const HELP = `Mission Mate — Star Citizen Game.log companion (v${MM_VERSION})

Usage:
  mission-mate [options]        Watch the log and push events
  mission-mate login --file <f> Store your HaulerHelper session token (from a file)
  mission-mate set-log <path>   Remember where your Game.log is (--clear to undo)
  mission-mate print-config     Show the resolved config path + state (--json for a machine-readable dump)

Options:
  --log <path>      Explicit Game.log path (skips auto-discovery)
  --channel <name>  LIVE | PTU | EPTU | TECH-PREVIEW | HOTFIX  (default LIVE)
  --replay          Parse the existing file from the start (not just new lines)
  --once            Single poll then exit (handy with --replay)
  --console         Print events locally; do not push to Supabase
  -h, --help        This help

Auth: in HaulerHelper's Mission Mate panel click 'Copy pairing token', save the
clipboard contents to a file, then:
  mission-mate login --file ./token.json
A real session exceeds the terminal's line limit, so file/pipe input is required.

Supabase creds come from config (supabaseUrl/supabaseAnonKey) or the env vars
SUPABASE_URL / SUPABASE_ANON_KEY (VITE_-prefixed also accepted).`;

function resolveCreds(config: { supabaseUrl?: string; supabaseAnonKey?: string }) {
  const url =
    config.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey =
    config.supabaseAnonKey ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;
  return { url, anonKey };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function doLogin(args: Args): Promise<void> {
  let raw: string;
  if (args.file) {
    // Best path for the real token: the session blob is far larger than a
    // terminal's ~4096-byte line limit, so a typed paste would be truncated.
    raw = await readFile(args.file, 'utf8');
  } else if (!stdin.isTTY) {
    // Piped in, e.g. `mission-mate login < token.json` — no tty line limit.
    raw = await readAllStdin();
  } else {
    console.error(
      'Refusing to read the token from an interactive prompt: a real session is\n' +
        'larger than the terminal line limit and would be truncated. Save the\n' +
        "localStorage 'haulerHelperAuth' value to a file and run:\n" +
        '  mission-mate login --file ./token.json\n' +
        '(or pipe it: mission-mate login < token.json)',
    );
    process.exit(1);
  }

  const session = parsePastedSession(raw);
  if (!session) {
    console.error('Could not find access_token / refresh_token in that value.');
    process.exit(1);
  }
  const config = await loadConfig();
  await saveConfig({ ...config, session });
  console.log(`Saved session to ${configPath()}`);
}

/** Save (or clear) the explicit Game.log path, so every later run finds it. */
async function doSetLog(args: Args): Promise<void> {
  const config = await loadConfig();

  if (args.clear) {
    const { logPath: _dropped, ...rest } = config;
    await saveConfig(rest);
    console.log(`Cleared the saved log path. Back to auto-discovery. (${configPath()})`);
    return;
  }

  if (!args.logPath) {
    console.error('Usage: mission-mate set-log <path to Game.log>   (or --clear)');
    process.exit(1);
  }

  const abs = resolve(args.logPath);
  try {
    if (!(await stat(abs)).isFile()) throw new Error('not a file');
  } catch {
    console.error(`No file at: ${abs}`);
    console.error(
      'Point this at the Game.log itself, not the folder holding it.',
    );
    process.exit(1);
  }

  await saveConfig({ ...config, logPath: abs });
  console.log(`Saved log path: ${abs}`);
  console.log(`Config: ${configPath()}`);
}

/**
 * Discovery failed. This is the single most common setup problem, and the
 * people hitting it are players, not developers — so spell out every option,
 * including hand-editing the JSON (they asked for exactly that).
 */
function explainMissingLog(channel: ScChannel, searched: string[]): void {
  const example =
    process.platform === 'win32'
      ? `D:/Program Files/Roberts Space Industries/StarCitizen/${channel}/Game.log`
      : `${process.env.HOME ?? '~'}/Games/star-citizen/drive_c/Program Files/Roberts Space Industries/StarCitizen/${channel}/Game.log`;

  const lines = [
    `Could not find your Star Citizen Game.log for the ${channel} build.`,
    '',
    'Looked in:',
    ...searched.map((p) => `  ${p}`),
    '',
    'Game.log sits next to the game itself, in the folder named after the build',
    `you play (${channel}). Once you have found it, pick either option below.`,
    '',
    'Option 1 — let Mission Mate write the setting for you (easiest):',
    `  mission-mate set-log "${example}"`,
    '  Keep the quotes; the path contains spaces. Run it once; it is remembered.',
    '',
    `Option 2 — edit the config file by hand: ${configPath()}`,
    '  The file is JSON: one pair of outer braces, and inside them a list of',
    '  "name": value lines separated by commas. Add a line named "logPath".',
    '',
    '  If your file currently looks like this:',
    '    {',
    '      "session": { "access_token": "…", "refresh_token": "…" }',
    '    }',
    '',
    '  then add a comma after the last existing line and put "logPath" below it:',
    '    {',
    '      "session": { "access_token": "…", "refresh_token": "…" },',
    `      "logPath": "${example}"`,
    '    }',
    '',
    '  If the file is empty or missing, the whole contents can be just:',
    '    {',
    `      "logPath": "${example}"`,
    '    }',
    '',
    '  Rules that trip people up:',
    '    - Keep the double quotes around both the name and the path.',
    '    - Every line inside the braces needs a comma after it EXCEPT the last one.',
    '    - On Windows, write the path with forward slashes (D:/Games/…) or with',
    '      doubled backslashes (D:\\Games\\…). A single backslash breaks the file.',
    '    - Save the file, then start Mission Mate again.',
    '',
    `Watching the wrong build? Add  --channel <name>  to pick another one.`,
    'LIVE, PTU, EPTU, TECH-PREVIEW and HOTFIX each keep their own Game.log.',
  ];
  console.error(lines.join('\n'));
}

async function doWatch(args: Args): Promise<void> {
  const config = await loadConfig();
  const channel = args.channel ?? config.channel ?? DEFAULT_CHANNEL;

  const logPath = await discoverLogPath(
    { ...defaultDiscoverOpts(channel), channel },
    args.logPath ?? config.logPath,
  );
  if (!logPath) {
    const override = args.logPath ?? config.logPath;
    if (override) {
      console.error(`The saved Game.log path does not exist: ${override}`);
      console.error(
        'Point Mission Mate at the current file:  mission-mate set-log <path>\n' +
          `(or clear it with  mission-mate set-log --clear  and let it search again)\n` +
          `Config: ${configPath()}`,
      );
    } else {
      explainMissingLog(channel, candidateLogPaths({ ...defaultDiscoverOpts(channel), channel }));
    }
    process.exit(1);
  }

  let sink: EventSink;
  const { url, anonKey } = resolveCreds(config);
  if (!args.forceConsole && url && anonKey && config.session) {
    const supa = new SupabaseSink({
      url,
      anonKey,
      session: config.session,
      // Persist rotated tokens so the next run doesn't fail to auth.
      onSession: async (session) => {
        const latest = await loadConfig();
        await saveConfig({ ...latest, session });
      },
    });
    const auth = await supa.authenticate();
    if (!auth.ok) {
      console.error(`Auth failed (${auth.error}). Re-run 'mission-mate login'.`);
      process.exit(1);
    }
    console.log(`Signed in (user ${auth.userId.slice(0, 8)}…) → pushing to Supabase`);
    sink = supa;
  } else {
    if (!args.forceConsole) {
      console.log('No account/creds — running in console mode (no push).');
    }
    sink = new ConsoleSink();
  }

  console.log(`Watching ${channel}: ${logPath}`);
  const controller = new AbortController();
  process.on('SIGINT', () => {
    console.log('\nStopping…');
    controller.abort();
  });

  await watch(sink, {
    logPath,
    channel,
    mmVersion: MM_VERSION,
    replay: args.replay,
    once: args.once,
    signal: controller.signal,
  });
  await sink.close();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'help':
      console.log(HELP);
      break;
    case 'login':
      await doLogin(args);
      break;
    case 'set-log':
      await doSetLog(args);
      break;
    case 'print-config': {
      const config = await loadConfig();
      if (args.json) {
        // Stable shape for the desktop shell (companion-desktop).
        const channel = config.channel ?? DEFAULT_CHANNEL;
        const resolved = await discoverLogPath(
          { ...defaultDiscoverOpts(channel), channel },
          config.logPath,
        );
        console.log(
          JSON.stringify({
            configPath: configPath(),
            channel,
            hasSession: Boolean(config.session),
            savedLogPath: config.logPath ?? null,
            resolvedLogPath: resolved,
          }),
        );
        break;
      }
      console.log(`Config path: ${configPath()}`);
      console.log(
        JSON.stringify(
          {
            ...config,
            session: config.session ? '<stored>' : undefined,
          },
          null,
          2,
        ),
      );
      break;
    }
    case 'watch':
      await doWatch(args);
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
