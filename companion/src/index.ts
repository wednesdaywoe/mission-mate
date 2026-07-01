/**
 * @hauler-helper/companion — library surface (the CLI is src/cli.ts).
 * Re-exports the pieces worth testing/reusing.
 */

export { planRead, LogTailer } from './tail.ts';
export type { ReadPlan, PollResult } from './tail.ts';
export {
  candidateLogPaths,
  discoverLogPath,
  defaultDiscoverOpts,
  DEFAULT_CHANNEL,
} from './discover.ts';
export type { ScChannel, DiscoverOpts } from './discover.ts';
export { ConsoleSink } from './sink.ts';
export type { EventSink, HeartbeatStatus } from './sink.ts';
export { SupabaseSink } from './supabase-sink.ts';
export { watch } from './watch.ts';
export type { WatchOpts } from './watch.ts';
export {
  loadConfig,
  saveConfig,
  configPath,
  configDir,
  parsePastedSession,
} from './config.ts';
export type { CompanionConfig, StoredSession } from './config.ts';
