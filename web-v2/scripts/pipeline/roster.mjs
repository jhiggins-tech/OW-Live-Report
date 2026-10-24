// Parses config/tracked-battletags.txt with the same rules as build-roster.mjs
// and fetch-snapshots.mjs: `Display | BattleTag | Notes` (latter two
// optional), `#` comments, and a lone BattleTag is allowed.

import { readFileSync } from 'node:fs';

// Returns [{ battleTag, playerId, display }] in file order.
export function loadRoster(rosterPath) {
  const out = [];
  for (const line of readFileSync(rosterPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|').map((p) => p.trim());
    const battleTag = parts.length === 1 ? parts[0] : parts[1];
    const display = parts.length === 1 ? parts[0]?.split('#')[0] : parts[0];
    if (!battleTag || !battleTag.includes('#')) continue;
    out.push({
      battleTag,
      // The stats store keeps player ids with '#' replaced by '-'.
      playerId: battleTag.replace(/#/g, '-'),
      display: display || battleTag.split('#')[0],
    });
  }
  return out;
}
