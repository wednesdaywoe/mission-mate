import { describe, it, expect, afterEach } from 'vitest';
import { planRead, LogTailer } from '../src/tail.ts';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('planRead — pure tail decision (GAME_LOG_SPEC §5)', () => {
  it('reads only the appended tail when the file grew', () => {
    expect(planRead(100, 250)).toEqual({ reset: false, from: 100, to: 250 });
  });
  it('reports nothing new when the size is unchanged', () => {
    expect(planRead(250, 250)).toEqual({ reset: false, from: 250, to: 250 });
  });
  it('resets to 0 when the file shrank (truncation/rotation on relaunch)', () => {
    expect(planRead(500, 80)).toEqual({ reset: true, from: 0, to: 80 });
  });
});

describe('LogTailer — incremental reads over a real temp file', () => {
  const dirs: string[] = [];
  const mkfile = (initial = ''): string => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-tail-'));
    dirs.push(dir);
    const path = join(dir, 'Game.log');
    writeFileSync(path, initial);
    return path;
  };
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('emits only complete lines and buffers a partial trailing line', async () => {
    const path = mkfile('alpha\nbeta\n');
    const tailer = new LogTailer(path);

    let r = await tailer.poll();
    expect(r.lines).toEqual(['alpha', 'beta']);

    // Write a half line (no newline yet) — must NOT be emitted.
    appendFileSync(path, 'gam');
    r = await tailer.poll();
    expect(r.lines).toEqual([]);

    // Complete it across the poll boundary — emitted whole, not split.
    appendFileSync(path, 'ma\ndelta\n');
    r = await tailer.poll();
    expect(r.lines).toEqual(['gamma', 'delta']);
  });

  it('seekToEnd skips existing content and only sees new lines', async () => {
    const path = mkfile('old1\nold2\n');
    const tailer = new LogTailer(path);
    await tailer.seekToEnd();
    appendFileSync(path, 'new1\n');
    const r = await tailer.poll();
    expect(r.lines).toEqual(['new1']);
  });

  it('detects truncation and re-reads from the start', async () => {
    const path = mkfile('aaa\nbbb\nccc\n'); // 12 bytes
    const tailer = new LogTailer(path);
    await tailer.poll();

    // Game relaunch truncates in place; the next poll catches the file while
    // the new session is still smaller than the old offset (the spec §5 size
    // heuristic — an equal-or-larger rewrite between polls is not detectable by
    // size alone, which matches how SC actually rotates: small, then grows).
    truncateSync(path, 0);
    writeFileSync(path, 'fresh\n'); // 6 bytes < 12
    const r = await tailer.poll();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['fresh']);
  });

  it('handles CRLF line endings', async () => {
    const path = mkfile('one\r\ntwo\r\n');
    const tailer = new LogTailer(path);
    const r = await tailer.poll();
    expect(r.lines).toEqual(['one', 'two']);
  });
});
