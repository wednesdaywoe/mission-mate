/**
 * Log-path discovery (MISSION_MATE_PLAN §5a, §9.6) — the one real
 * platform divergence. Windows-first, Linux/Wine compatible, no macOS.
 *
 * `candidateLogPaths` is pure (takes platform + home + channel) so it's
 * testable; `discoverLogPath` stats the candidates and returns the first that
 * exists. The user can always override with an explicit path (config / --log).
 */

import { stat } from 'node:fs/promises';

/** SC release channels, each with its own Game.log. */
export type ScChannel = 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW' | 'HOTFIX';

export const DEFAULT_CHANNEL: ScChannel = 'LIVE';

const RSI_SUFFIX = (channel: string) =>
  `Roberts Space Industries/StarCitizen/${channel}/Game.log`;

export interface DiscoverOpts {
  platform: NodeJS.Platform;
  /** $HOME on POSIX, %USERPROFILE% on Windows. */
  home: string;
  channel: ScChannel;
  /** Windows program-files roots / extra library drives, if known. */
  programFiles?: string[];
}

/**
 * Ordered list of plausible Game.log locations for a platform + channel.
 * Pure: no filesystem access, so unit-testable.
 */
export function candidateLogPaths(opts: DiscoverOpts): string[] {
  const { platform, home, channel } = opts;
  const suffix = RSI_SUFFIX(channel);

  if (platform === 'win32') {
    const roots = opts.programFiles ?? [
      'C:/Program Files',
      'C:/Program Files (x86)',
    ];
    // Default install + common alternate library drives (RSI lets you pick).
    const drives = ['C:', 'D:', 'E:'];
    return [
      ...roots.map((r) => `${r}/${suffix}`),
      ...drives.map((d) => `${d}/${suffix}`),
    ];
  }

  // Linux / Wine. SC runs under a Wine/Proton prefix; the RSI tree sits under
  // that prefix's drive_c. Cover the common Lutris/Wine prefix locations.
  const prefixes = [
    `${home}/Games/star-citizen/drive_c/Program Files`,
    `${home}/.wine/drive_c/Program Files`,
    `${home}/.local/share/lutris/runners/wine/star-citizen/drive_c/Program Files`,
    `${home}/Games/starcitizen/drive_c/Program Files`,
  ];
  return prefixes.map((p) => `${p}/${suffix}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Return the first candidate Game.log that actually exists, or null. Pass an
 * explicit `override` to short-circuit discovery (still verified to exist).
 */
export async function discoverLogPath(
  opts: DiscoverOpts,
  override?: string,
): Promise<string | null> {
  if (override) return (await exists(override)) ? override : null;
  for (const candidate of candidateLogPaths(opts)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** Convenience: discover from the live process environment. */
export function defaultDiscoverOpts(channel: ScChannel = DEFAULT_CHANNEL): DiscoverOpts {
  const home =
    process.env.HOME ?? process.env.USERPROFILE ?? process.env.HOMEPATH ?? '';
  return { platform: process.platform, home, channel };
}
