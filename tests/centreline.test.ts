import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { centreLine } from '../src/game/centreline';
import type { TrackFile } from '../src/track/types';

describe('centre line', () => {
  it('walks the test oval all the way round', () => {
    const t = JSON.parse(fs.readFileSync('src/track/tracks/test-oval.json', 'utf8')) as TrackFile;
    const c = centreLine(t);
    expect(c.closed).toBe(true);
    expect(c.pieces.length).toBe(36);
    expect(c.length).toBeGreaterThan(30 * 62);
  });
  it('walks the local reference tracks (skips without local-tracks/)', () => {
    if (!fs.existsSync('local-tracks')) return;
    const files = fs.readdirSync('local-tracks').filter((f) => f.endsWith('.json'));
    let closed = 0;
    for (const f of files) {
      const c = centreLine(JSON.parse(fs.readFileSync(`local-tracks/${f}`, 'utf8')) as TrackFile);
      if (c.closed) closed++;
      else console.log(`${f}: open after ${c.pieces.length} pieces`);
    }
    expect(closed).toBeGreaterThan(files.length / 2);
  });
});
