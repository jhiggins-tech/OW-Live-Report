#!/usr/bin/env node
// Emit per-route HTML stubs into ../../docs/ so GitHub Pages can serve
// canonical (non-hash) URLs without 404s.
//
// For each public route we want crawlable, we write a near-copy of the
// freshly-built docs/index.html with a route-specific <title> and
// OpenGraph tags, so link previews (Slack, Discord, etc.) differ per URL.
// Player stubs additionally get the player's Battle.net avatar URL as
// og:image, fetched once from InfluxDB at build time. Every stub loads
// the same content-hashed JS bundle Vite emitted, so the SPA boots
// normally and the router takes over client-side.
//
// Also handles roster removals: any docs/players/<slug>/ directory whose
// slug is not in the current roster is deleted before new stubs are written.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..', '..', 'docs');
const shellPath = resolve(docsDir, 'index.html');
const rosterPath = resolve(docsDir, 'data', 'roster.json');
const runtimeConfigPath = resolve(docsDir, 'data', 'runtime-config.json');

const RESERVED_ROUTES = [
  { dir: 'settings', title: 'Settings — OW Live Report', description: 'Configure data sources and display preferences.' },
  { dir: 'optimizer', title: 'Lineup Optimizer — OW Live Report', description: 'Suggest team comps based on player hero pools.' },
];

function htmlEscape(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStub(shell, { title, description, image }) {
  const safeTitle = htmlEscape(title);
  const safeDesc = htmlEscape(description);
  const ogTags = [
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
  ];
  if (image) {
    const safeImage = htmlEscape(image);
    ogTags.push(`<meta property="og:image" content="${safeImage}" />`);
    ogTags.push(`<meta name="twitter:image" content="${safeImage}" />`);
    ogTags.push(`<meta name="twitter:card" content="summary" />`);
  } else {
    ogTags.push(`<meta name="twitter:card" content="summary" />`);
  }
  return shell.replace(
    /<title>[^<]*<\/title>/,
    `<title>${safeTitle}</title>\n    ${ogTags.join('\n    ')}`,
  );
}

function writeStub(routeDir, html) {
  const target = resolve(docsDir, routeDir, 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
}

// Fetch one row per player_id from InfluxDB, returning a Map<playerId, avatarUrl>.
// Resolves to an empty Map on any failure — preview-image is a polish layer,
// not worth failing the whole deploy over.
async function fetchAvatars(players) {
  let queryUrl;
  let database;
  try {
    const cfg = JSON.parse(readFileSync(runtimeConfigPath, 'utf8'));
    queryUrl = cfg?.influx?.queryUrl;
    database = cfg?.influx?.database;
  } catch {
    // runtime-config missing or unreadable; skip avatars.
  }
  if (!queryUrl || !database || players.length === 0) {
    return new Map();
  }
  // Quote player_id values for safe InfluxQL string literals. Player IDs
  // are derived from BattleTags (alnum + '-'), so escaping single-quotes is
  // belt-and-braces.
  const statements = players.map(
    (p) =>
      `SELECT last("avatar") AS avatar FROM "player_summary" WHERE "player"='${String(p.playerId).replace(/'/g, "\\'")}' GROUP BY "player"`,
  );
  const params = new URLSearchParams({ db: database, q: statements.join('; '), epoch: 'ms' });
  const url = `${queryUrl}?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`build-stubs: avatar fetch failed (HTTP ${res.status}); skipping og:image.`);
      return new Map();
    }
    const body = await res.json();
    const out = new Map();
    for (const result of body?.results ?? []) {
      for (const series of result?.series ?? []) {
        const playerId = series?.tags?.player;
        const cols = series?.columns ?? [];
        const avatarIdx = cols.indexOf('avatar');
        const value = series?.values?.[0]?.[avatarIdx];
        if (playerId && typeof value === 'string' && value) {
          out.set(playerId, value);
        }
      }
    }
    return out;
  } catch (err) {
    console.warn(`build-stubs: avatar fetch errored (${err.message}); skipping og:image.`);
    return new Map();
  }
}

if (!existsSync(shellPath)) {
  console.error(`build-stubs: missing ${shellPath} — run vite build first.`);
  process.exit(1);
}
if (!existsSync(rosterPath)) {
  console.error(`build-stubs: missing ${rosterPath} — run build:roster first.`);
  process.exit(1);
}

const shell = readFileSync(shellPath, 'utf8');
const { players = [] } = JSON.parse(readFileSync(rosterPath, 'utf8'));

const slugs = new Set();
for (const p of players) {
  if (!p?.slug) continue;
  if (slugs.has(p.slug)) {
    console.error(`build-stubs: duplicate slug "${p.slug}" — fix build-roster before stub emit.`);
    process.exit(1);
  }
  slugs.add(p.slug);
}

// Stale-stub cleanup: drop any docs/players/<slug>/ that isn't in the
// current roster. (Roster removals → next deploy deletes the stub.)
const playersDir = resolve(docsDir, 'players');
if (existsSync(playersDir)) {
  for (const entry of readdirSync(playersDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !slugs.has(entry.name)) {
      rmSync(resolve(playersDir, entry.name), { recursive: true, force: true });
      console.log(`build-stubs: removed stale player stub ${entry.name}`);
    }
  }
}

const avatars = await fetchAvatars(players);

let written = 0;
let withAvatar = 0;
for (const player of players) {
  const title = `${player.display} — OW Live Report`;
  const description = `Overwatch hero pool, role breakdown, and performance trends for ${player.display}.`;
  const image = avatars.get(player.playerId) ?? null;
  if (image) withAvatar += 1;
  writeStub(`players/${player.slug}`, renderStub(shell, { title, description, image }));
  written += 1;
}

for (const route of RESERVED_ROUTES) {
  writeStub(route.dir, renderStub(shell, { title: route.title, description: route.description }));
  written += 1;
}

// 404.html lives at docs root. GitHub Pages serves it (with HTTP 404)
// for any path that doesn't match a file; the SPA boots and renders
// NotFoundPage based on the URL path.
writeFileSync(
  resolve(docsDir, '404.html'),
  renderStub(shell, {
    title: 'Not found — OW Live Report',
    description: 'The requested page could not be found.',
  }),
);
written += 1;

console.log(
  `build-stubs: wrote ${written} stub(s) (${players.length} player + ${RESERVED_ROUTES.length} reserved + 404)` +
    (withAvatar ? `, ${withAvatar}/${players.length} with avatar.` : ', no avatars fetched.'),
);
