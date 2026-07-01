import { describe, it, expect } from 'vitest';
import { candidateLogPaths } from '../src/discover.ts';
import { parsePastedSession } from '../src/config.ts';

describe('candidateLogPaths — platform path discovery (§5a)', () => {
  it('lists default + alternate-drive paths on Windows for the channel', () => {
    const paths = candidateLogPaths({
      platform: 'win32',
      home: 'C:/Users/woe',
      channel: 'LIVE',
    });
    expect(paths).toContain(
      'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
    );
    // Non-default library drive (RSI launcher lets you pick).
    expect(paths.some((p) => p.startsWith('D:/'))).toBe(true);
  });

  it('targets Wine-prefix locations on Linux and respects the channel', () => {
    const paths = candidateLogPaths({
      platform: 'linux',
      home: '/home/jiiwii',
      channel: 'PTU',
    });
    expect(paths.every((p) => p.endsWith('/StarCitizen/PTU/Game.log'))).toBe(true);
    expect(
      paths.some((p) => p.startsWith('/home/jiiwii/Games/star-citizen/drive_c')),
    ).toBe(true);
  });
});

describe('parsePastedSession — paste-token auth (§13)', () => {
  it('extracts tokens from the supabase-js localStorage shape (nested)', () => {
    const raw = JSON.stringify({
      currentSession: { access_token: 'acc', refresh_token: 'ref', expires_at: 1 },
    });
    expect(parsePastedSession(raw)).toEqual({ access_token: 'acc', refresh_token: 'ref' });
  });

  it('accepts a bare { access_token, refresh_token } object', () => {
    const raw = JSON.stringify({ access_token: 'a', refresh_token: 'r' });
    expect(parsePastedSession(raw)).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('decodes the newer base64- prefixed storage form', () => {
    const json = JSON.stringify({ access_token: 'acc', refresh_token: 'ref', user: {} });
    const raw = 'base64-' + Buffer.from(json, 'utf8').toString('base64');
    expect(parsePastedSession(raw)).toEqual({ access_token: 'acc', refresh_token: 'ref' });
  });

  it('handles a copied DevTools row: key prefix + double-encoded value', () => {
    const session = { provider_token: 'p', access_token: 'acc', refresh_token: 'ref' };
    // DevTools copies `haulerHelperAuth:"<json-string-encoded session>"`.
    const raw = 'haulerHelperAuth:' + JSON.stringify(JSON.stringify(session));
    expect(parsePastedSession(raw)).toEqual({ access_token: 'acc', refresh_token: 'ref' });
  });

  it('recovers a wrapped, unescaped DevTools blob via token extraction', () => {
    // What "copy row" actually yields: key prefix + outer quotes but the inner
    // object quotes are NOT escaped, so it is not valid JSON to parse.
    const raw =
      'haulerHelperAuth:"{"provider_token":"p","access_token":"acc","refresh_token":"ref","user":{"is_anonymous":false}}"';
    expect(parsePastedSession(raw)).toEqual({ access_token: 'acc', refresh_token: 'ref' });
  });

  it('returns null for junk or missing tokens', () => {
    expect(parsePastedSession('not json')).toBeNull();
    expect(parsePastedSession(JSON.stringify({ access_token: 'a' }))).toBeNull();
  });
});
