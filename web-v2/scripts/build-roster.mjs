#!/usr/bin/env node
// Reads ../config/tracked-battletags.txt and emits public/data/roster.json.
// Format: `Display | BattleTag | Notes` (latter two optional), `#` for comments.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rosterTxt = resolve(here, '..', '..', 'config', 'tracked-battletags.txt');
const outFile = resolve(here, '..', 'public', 'data', 'roster.json');

function slug(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

const raw = readFileSync(rosterTxt, 'utf8');
const players = raw.split(/\r?\n/).map(parseLine).filter(Boolean);
const seen = new Set();
for (const p of players) {
  if (seen.has(p.slug)) {
    p.slug = `${p.slug}-${slug(p.battleTag.split('#')[1] ?? '')}`;
  }
  seen.add(p.slug);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify({ generatedAt: new Date().toISOString(), players }, null, 2) + '\n',
);
console.log(`build-roster: wrote ${players.length} players to ${outFile}`);
