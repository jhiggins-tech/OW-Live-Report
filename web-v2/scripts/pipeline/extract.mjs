// Turns one OverFast `GET /players/{id}` response into a Sample, the unit the
// season/roll-up code ingests. Pure: no network, no files. The field mapping
// mirrors what scrape.py (the retired scraper) wrote and what
// fetch-snapshots.mjs read back, so rows stay compatible with the SPA.

import { GAMEMODE, PLATFORM, ROLES } from './constants.mjs';
import { toNumber, utcDay } from './util.mjs';

// [field, canonical category, OverFast stat key]. Order = Sample field order.
const CAREER_MAP = [
  ['eliminations', 'combat', 'eliminations'],
  ['deaths', 'combat', 'deaths'],
  ['assists', 'assists', 'assists'],
  ['healingDone', 'assists', 'healing_done'],
  ['healingPer10Min', 'average', 'healing_done_avg_per_10_min'],
  ['gamesWon', 'game', 'games_won'],
  ['gamesPlayed', 'game', 'games_played'],
  ['winPercentage', 'game', 'win_percentage'],
  ['timePlayed', 'game', 'time_played'],
];
// The only categories we read. `best`, `hero_specific` and `match_awards`
// carry same-looking keys with different meanings, so they're ignored.
const CATEGORIES = ['combat', 'assists', 'average', 'game'];

const str = (v) => (typeof v === 'string' ? v : null);
const url = (v) => (typeof v === 'string' && v !== '' ? v : null);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// One hero's `[{category, stats: [{key, value}]}]` list → the 9 career fields.
// Each key is looked up in its own category first, then in the other
// canonical ones (OverFast has moved stats between categories before).
// Returns null when the hero carries none of the stats.
function extractHero(categories) {
  if (!Array.isArray(categories)) return null;
  const byCategory = new Map();
  for (const entry of categories) {
    if (!isObject(entry) || !Array.isArray(entry.stats)) continue;
    const keys = byCategory.get(entry.category) ?? new Map();
    for (const stat of entry.stats) {
      if (!isObject(stat) || typeof stat.key !== 'string') continue;
      const value = toNumber(stat.value);
      if (value !== null && !keys.has(stat.key)) keys.set(stat.key, value);
    }
    byCategory.set(entry.category, keys);
  }

  const out = {};
  let found = false;
  for (const [field, category, key] of CAREER_MAP) {
    let value = byCategory.get(category)?.get(key) ?? null;
    if (value === null) {
      for (const other of CATEGORIES) {
        value = byCategory.get(other)?.get(key) ?? null;
        if (value !== null) break;
      }
    }
    out[field] = value;
    if (value !== null) found = true;
  }
  return found ? out : null;
}

export function extractSample(playerId, body, fetchedAt, opts = {}) {
  const { platform = PLATFORM, gamemode = GAMEMODE } = opts;
  const summary = isObject(body?.summary) ? body.summary : null;

  const comp = isObject(summary?.competitive?.[platform]) ? summary.competitive[platform] : null;
  const rankSeason = toNumber(comp?.season);

  // Blizzard leaves a role null until it's ranked; skip anything incomplete.
  const ranks = [];
  for (const role of ROLES) {
    const r = comp?.[role];
    if (!isObject(r)) continue;
    const tier = toNumber(r.tier);
    if (tier === null || typeof r.division !== 'string' || r.division === '') continue;
    // rank_icon is the tier badge, tier_icon the division-number overlay;
    // icons.mjs turns them into the global rank-insignia map.
    ranks.push({
      role, tier, division: r.division, season: rankSeason, rankIcon: url(r.rank_icon), tierIcon: url(r.tier_icon),
    });
  }

  let profile = null;
  if (summary) {
    const updated = toNumber(summary.last_updated_at);
    profile = {
      username: str(summary.username),
      avatar: str(summary.avatar),
      namecard: str(summary.namecard),
      title: str(summary.title),
      endorsementLevel: toNumber(summary.endorsement?.level),
      endorsementFrame: str(summary.endorsement?.frame),
      lastUpdatedAt: updated === null ? null : updated * 1000,
    };
  }

  // A private profile (or no competitive play) has no career_stats at all.
  const careerStats = body?.stats?.[platform]?.[gamemode]?.career_stats;
  let career = null;
  if (isObject(careerStats)) {
    career = {};
    for (const [hero, categories] of Object.entries(careerStats)) {
      const fields = extractHero(categories);
      if (fields) career[hero] = fields;
    }
  }

  return {
    player: playerId,
    fetchedAt,
    day: utcDay(fetchedAt),
    rankSeason,
    ranks,
    profile,
    career,
  };
}
