// Tests for roster.mjs and util.mjs (no PRD id: small pure helpers).

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRoster } from './roster.mjs';
import { compareBy, utcDay } from './util.mjs';
import { at, tmpDir } from './__fixtures__/helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('loadRoster parses Display | BattleTag | Notes, a lone BattleTag and comments', () => {
  const file = join(tmpDir(), 'roster.txt');
  writeFileSync(file, [
    '# comment',
    '',
    'Kie | Kieness#6123 | Intel',
    '  Lank#21912  ',
    'LankCity | Lank#21912x',
    'not a battletag',
    '# Ignored | Someone#1',
    'Melrose | Kiddo#11482\r',
  ].join('\n'));
  assert.deepEqual(loadRoster(file), [
    { battleTag: 'Kieness#6123', playerId: 'Kieness-6123', display: 'Kie' },
    { battleTag: 'Lank#21912', playerId: 'Lank-21912', display: 'Lank' },
    { battleTag: 'Lank#21912x', playerId: 'Lank-21912x', display: 'LankCity' },
    { battleTag: 'Kiddo#11482', playerId: 'Kiddo-11482', display: 'Melrose' },
  ]);
});

test('loadRoster reads the real roster file', () => {
  const roster = loadRoster(join(here, '..', '..', '..', 'config', 'tracked-battletags.txt'));
  assert.ok(roster.length >= 1);
  for (const p of roster) {
    assert.match(p.playerId, /^[^#\s]+-\d+$/);
    assert.ok(p.battleTag.includes('#'));
  }
});

test('utcDay floors to UTC midnight; compareBy orders with plain <', () => {
  assert.equal(utcDay(at('2026-10-24T21:37:00Z')), at('2026-10-24T00:00:00Z'));
  assert.equal(utcDay(at('2026-10-24T00:00:00Z')), at('2026-10-24T00:00:00Z'));
  assert.equal(utcDay(at('2026-10-23T23:59:59.999Z')), at('2026-10-23T00:00:00Z'));
  const rows = [{ a: 2, b: 'x' }, { a: 1, b: 'b' }, { a: 1, b: 'B' }, { a: 1, b: 'a' }];
  assert.deepEqual(rows.sort(compareBy(['a', 'b'])).map((r) => r.b), ['B', 'a', 'b', 'x']);
});
