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

import { readFile } from 'node:fs/promises';
import { stdin } from 'node:process';
import {
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
  command: 'watch' | 'login' | 'print-config' | 'help';
  logPath?: string;
  channel: ScChannel;
  replay: boolean;
  once: boolean;
  forceConsole: boolean;
  /** For `login`: read the session blob from this file instead of a prompt. */
  file?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'watch',
    channel: DEFAULT_CHANNEL,
    replay: false,
    once: false,
    forceConsole: false,
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
  mission-mate print-config     Show the resolved config path + state

Options:
  --log <path>      Explicit Game.log path (skips auto-discovery)
  --channel <name>  LIVE | PTU | EPTU | TECH-PREVIEW | HOTFIX  (default LIVE)
  --replay          Parse the existing file from the start (not just new lines)
  --once            Single poll then exit (handy with --replay)
  --console         Print events locally; do not push to Supabase
  -h, --help        This help

Auth: save the browser localStorage value 'haulerHelperAuth' (HaulerHelper,
DevTools → Application → Local Storage) to a file, then:
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

async function doWatch(args: Args): Promise<void> {
  const config = await loadConfig();
  const channel = args.channel ?? config.channel ?? DEFAULT_CHANNEL;

  const logPath = await discoverLogPath(
    { ...defaultDiscoverOpts(channel), channel },
    args.logPath ?? config.logPath,
  );
  if (!logPath) {
    console.error(
      'Could not find Game.log. Pass --log <path> or set logPath in config.',
    );
    console.error(`Config: ${configPath()}`);
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
    case 'print-config': {
      const config = await loadConfig();
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
