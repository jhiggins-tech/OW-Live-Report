#!/usr/bin/env node
// Reads ../config/tracked-battletags.txt and emits public/data/roster.json.
// Format: `Display | BattleTag | Notes` (latter two optional), `#` for comments.
//
// Also reads ../config/team.sample.json (optional) for player_overrides:
//   - hidden_heroes (string list, by display name): default-hide on the
//     player's hero leaderboard until the user toggles.
//   - locked_role: tank | damage | support — UI hint that the player queues
//     this role primarily.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rosterTxt = resolve(here, '..', '..', 'config', 'tracked-battletags.txt');
const teamConfig = resolve(here, '..', '..', 'config', 'team.sample.json');
const outFile = resolve(here, '..', 'public', 'data', 'roster.json');

function slug(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mirror of src/lib/normalize/heroKey.ts so admin-set hidden_heroes
// (display names like "Widowmaker", "D.Va") normalize to the same key
// the runtime catalog uses.
const HERO_SPECIAL_CASES = {
  'd.va': 'dva',
  'd va': 'dva',
  'soldier 76': 'soldier-76',
  'soldier: 76': 'soldier-76',
  'junker queen': 'junker-queen',
  'wrecking ball': 'wrecking-ball',
};
function heroKey(input) {
  if (!input) return null;
  const normalized = String(input).trim().toLowerCase();
  if (!normalized) return null;
  if (HERO_SPECIAL_CASES[normalized]) return HERO_SPECIAL_CASES[normalized];
  const k = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return k || null;
}

function normalizeRole(raw) {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase();
  if (lower === 'dps' || lower === 'damage') return 'damage';
  if (lower === 'tank' || lower === 'support') return lower;
  return null;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const parts = trimmed.split('|').map((p) => p.trim());
  let battleTag;
  let display;
  let notes;
  if (parts.length === 1) {
    battleTag = parts[0];
    display = parts[0]?.split('#')[0];
  } else {
    display = parts[0];
    battleTag = parts[1];
    notes = parts[2] || undefined;
  }
  if (!battleTag || !battleTag.includes('#')) return null;
  return {
    battleTag,
    // InfluxDB stores player IDs with '#' replaced by '-' (V1 parity:
    // Common.ps1:6 ConvertTo-NormalizedBattleTag).
    playerId: battleTag.replace(/#/g, '-'),
    display: display || battleTag.split('#')[0],
    notes,
    slug: slug(display || battleTag.split('#')[0]),
  };
}

function loadOverridesByBattleTag() {
  if (!existsSync(teamConfig)) return new Map();
  try {
    const json = JSON.parse(readFileSync(teamConfig, 'utf8'));
    const overrides = Array.isArray(json?.player_overrides) ? json.player_overrides : [];
    const map = new Map();
    for (const entry of overrides) {
      const tag = entry?.player;
      if (typeof tag !== 'string' || !tag.includes('#')) continue;
      const hiddenHeroes = Array.isArray(entry.hidden_heroes)
        ? entry.hidden_heroes.map(heroKey).filter(Boolean)
        : [];
      const lockedRole = normalizeRole(entry.locked_role);
      if (hiddenHeroes.length === 0 && !lockedRole) continue;
      map.set(tag.toLowerCase(), { hiddenHeroes, lockedRole });
    }
    return map;
  } catch (err) {
    console.warn(`build-roster: could not parse ${teamConfig}: ${err.message}`);
    return new Map();
  }
}

const raw = readFileSync(rosterTxt, 'utf8');
const players = raw.split(/\r?\n/).map(parseLine).filter(Boolean);
const overrides = loadOverridesByBattleTag();

const seen = new Set();
for (const p of players) {
  if (seen.has(p.slug)) {
    p.slug = `${p.slug}-${slug(p.battleTag.split('#')[1] ?? '')}`;
  }
  seen.add(p.slug);
  const override = overrides.get(p.battleTag.toLowerCase());
  if (override) {
    if (override.hiddenHeroes.length > 0) p.hiddenHeroes = override.hiddenHeroes;
    if (override.lockedRole) p.lockedRole = override.lockedRole;
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify({ generatedAt: new Date().toISOString(), players }, null, 2) + '\n',
);
const overrideCount = players.filter((p) => p.hiddenHeroes || p.lockedRole).length;
console.log(`build-roster: wrote ${players.length} players to ${outFile}` + (overrideCount ? ` (${overrideCount} with admin overrides)` : ''));
