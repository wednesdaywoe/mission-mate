/**
 * Companion configuration + paste-token auth storage (MISSION_MATE_PLAN §13:
 * paste-token chosen over device-code for v1, since web auth is Discord-OAuth
 * only and a headless OAuth flow is disproportionate).
 *
 * The user copies their Supabase session from the web app (browser localStorage
 * key `haulerHelperAuth`) and pastes it into `mission-mate login`. We extract
 * the access + refresh tokens and persist them in the OS config dir.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ScChannel } from './discover.ts';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
}

export interface CompanionConfig {
  /** Supabase project URL + anon key (else read from env at runtime). */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Persisted paste-token session. */
  session?: StoredSession;
  /** Explicit Game.log path override (skips discovery). */
  logPath?: string;
  channel?: ScChannel;
}

/** `%APPDATA%\mission-mate` on Windows, `$XDG_CONFIG_HOME|~/.config/mission-mate` elsewhere. */
export function configDir(): string {
  if (process.platform === 'win32') {
    const base =
      process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
    return join(base, 'mission-mate');
  }
  const base = process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '', '.config');
  return join(base, 'mission-mate');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function loadConfig(): Promise<CompanionConfig> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as CompanionConfig;
  } catch {
    return {};
  }
}

export async function saveConfig(config: CompanionConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  // Tokens live here — keep the file owner-only where the OS supports it.
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Extract a Supabase session from whatever the user pasted/saved. Tolerant of
 * the several shapes DevTools "copy" produces. Handles, in any combination:
 *   - a leading `haulerHelperAuth:` storage-key prefix (copying the whole row);
 *   - the `base64-<base64(JSON)>` form auth-js writes for large sessions;
 *   - double JSON-encoding (a value stored as a quoted, escaped JSON string);
 *   - a session nested under `currentSession` / `session`;
 *   - a bare `{ access_token, refresh_token }` object.
 * Returns null if no token pair is found.
 */
export function parsePastedSession(raw: string): StoredSession | null {
  let text = raw.trim().replace(/^haulerHelperAuth\s*:\s*/, '').trim();
  if (text.startsWith('base64-')) {
    try {
      text = Buffer.from(text.slice('base64-'.length), 'base64').toString('utf8');
    } catch {
      /* fall through to regex */
    }
  }

  // Preferred: structured parse, peeling JSON string-encoding layers.
  let probe = text;
  for (let depth = 0; depth < 5; depth++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(probe);
    } catch {
      break;
    }
    if (typeof parsed === 'string') {
      probe = parsed; // double-encoded — unwrap and retry
      continue;
    }
    const o = parsed as Record<string, unknown>;
    const c = (o?.currentSession ?? o?.session ?? o) as Partial<StoredSession>;
    if (typeof c?.access_token === 'string' && typeof c?.refresh_token === 'string') {
      return { access_token: c.access_token, refresh_token: c.refresh_token };
    }
    break;
  }

  // Fallback: pull the tokens straight out of the text. Robust to the wrapped /
  // unescaped blobs DevTools "copy row" produces (JWTs contain no `"`).
  const at = /"access_token"\s*:\s*"([^"]+)"/.exec(text);
  const rt = /"refresh_token"\s*:\s*"([^"]+)"/.exec(text);
  if (at && rt) return { access_token: at[1], refresh_token: rt[1] };
  return null;
}
