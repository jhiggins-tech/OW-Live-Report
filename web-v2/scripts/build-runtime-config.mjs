#!/usr/bin/env node
// Reads env vars and writes public/data/runtime-config.json. Vite copies
// public/* into docs/v2/ so the file ships at /v2/data/runtime-config.json.
// All values fall back to DEFAULT_CONFIG in src/lib/runtimeConfig.ts when the
// env var is unset, so this script never fails the build.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '..', 'public', 'data', 'runtime-config.json');

function pickStr(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickInt(...keys) {
  for (const k of keys) {
    const raw = process.env[k];
    if (typeof raw === 'string' && raw.trim()) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = compact(v);
      if (Object.keys(inner).length > 0) out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Both unprefixed and VITE_-prefixed env vars are accepted so the same names
// work whether they're set by CI for the build step or by a local .env file.
const config = compact({
  team: {
    name: pickStr('TEAM_NAME', 'VITE_TEAM_NAME'),
    subtitle: pickStr('TEAM_SUBTITLE', 'VITE_TEAM_SUBTITLE'),
  },
  ui: {
    topHeroCount: pickInt('TOP_HERO_COUNT', 'VITE_TOP_HERO_COUNT'),
    linkToV1Url: pickStr('LINK_TO_V1_URL', 'VITE_LINK_TO_V1_URL'),
  },
  influx: {
    queryUrl: pickStr('INFLUX_QUERY_URL', 'VITE_INFLUX_QUERY_URL'),
    database: pickStr('INFLUX_DATABASE', 'VITE_INFLUX_DATABASE'),
    gamemode: pickStr('INFLUX_GAMEMODE', 'VITE_INFLUX_GAMEMODE'),
  },
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(config, null, 2) + '\n');
const keys = Object.keys(config);
console.log(`build-runtime-config: wrote ${keys.length} top-level sections to ${outFile}` + (keys.length === 0 ? ' (all defaults)' : ` (${keys.join(', ')})`));
