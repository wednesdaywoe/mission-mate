/**
 * Supabase EventSink — writes the append-only fact stream (`mission_log_events`)
 * and upserts presence (`companion_status`). Those tables are provisioned by the
 * HaulerHelper backend (RLS-scoped per user).
 *
 * The companion emits FACTS; the web app interprets/correlates them (§8). So the
 * row keeps denormalized columns for querying plus a full `payload` jsonb so no
 * detail (marker positions, objective state) is lost.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseContractName, type LogEvent } from '@hauler-helper/log-parser';
import type { EventSink, HeartbeatStatus } from './sink.ts';
import type { StoredSession } from './config.ts';

export interface SupabaseSinkOpts {
  url: string;
  anonKey: string;
  session: StoredSession;
  /**
   * Called whenever the session is (re)issued. Supabase rotates the refresh
   * token on every refresh, so the caller MUST persist the new pair or the next
   * run will fail with "Auth session missing". Wired to saveConfig in the CLI.
   */
  onSession?: (session: StoredSession) => void | Promise<void>;
}

interface MissionLogRow {
  user_id: string;
  game_mission_id: string | null;
  event_type: string;
  contract_name: string | null;
  generator_name: string | null;
  region: string | null;
  raw: string;
  payload: LogEvent;
  event_at: string;
}

/**
 * Flatten a parsed event into a fact row. `event_type` follows §8's lifecycle
 * vocabulary: an `end` event becomes its completion outcome
 * (complete | abandon | fail); everything else keeps its parser type.
 */
function toRow(userId: string, ev: LogEvent): MissionLogRow {
  const base: MissionLogRow = {
    user_id: userId,
    game_mission_id: 'missionId' in ev ? ev.missionId : null,
    event_type: ev.type,
    contract_name: null,
    generator_name: null,
    region: null,
    raw: ev.raw,
    payload: ev,
    event_at: ev.timestamp,
  };
  switch (ev.type) {
    case 'marker':
      base.contract_name = ev.contract;
      base.generator_name = ev.generatorName;
      base.region = parseContractName(ev.contract)?.region ?? null;
      break;
    case 'end':
      // Collapse to the lifecycle outcome string the web app keys on.
      base.event_type = ev.completionType.toLowerCase();
      break;
  }
  return base;
}

export class SupabaseSink implements EventSink {
  private client: SupabaseClient;
  private userId: string | null = null;

  constructor(private readonly opts: SupabaseSinkOpts) {
    this.client = createClient(opts.url, opts.anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    // Persist every (re)issued session so a rotated refresh token survives to
    // the next run instead of being silently lost.
    this.client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token && session?.refresh_token) {
        void this.opts.onSession?.({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
    });
  }

  /** Restore the paste-token session and resolve the user id. Call once before use. */
  async authenticate(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
    const { data, error } = await this.client.auth.setSession({
      access_token: this.opts.session.access_token,
      refresh_token: this.opts.session.refresh_token,
    });
    if (error || !data.user) {
      return { ok: false, error: error?.message ?? 'no user in session' };
    }
    this.userId = data.user.id;
    return { ok: true, userId: data.user.id };
  }

  async emit(event: LogEvent): Promise<void> {
    if (event.type === 'log-started') return; // session marker, not a mission fact
    if (!this.userId) throw new Error('SupabaseSink.emit before authenticate()');
    const { error } = await this.client
      .from('mission_log_events')
      .insert(toRow(this.userId, event));
    if (error) console.error(`[supabase] insert failed: ${error.message}`);
  }

  async heartbeat(status: HeartbeatStatus): Promise<void> {
    if (!this.userId) throw new Error('SupabaseSink.heartbeat before authenticate()');
    const { error } = await this.client.from('companion_status').upsert(
      {
        user_id: this.userId,
        last_seen_at: new Date().toISOString(),
        mm_version: status.mmVersion,
        log_path: status.logPath,
        sc_channel: status.scChannel,
      },
      { onConflict: 'user_id' },
    );
    if (error) console.error(`[supabase] heartbeat failed: ${error.message}`);
  }

  async close(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' });
  }
}
