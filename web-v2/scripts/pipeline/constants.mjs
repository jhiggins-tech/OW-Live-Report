// Shared constants and dataset schemas for the V3 polling pipeline (see
// plan/v3-static-season-snapshots.md). Pure data, no I/O: the poller
// (poll.mjs), the library modules and validate.mjs all read the same
// definitions, so the writer and the validator can't drift apart.

export const LAYOUT_VERSION = 2;
export const GAMEMODE = 'competitive';
export const PLATFORM = 'pc';
export const ROLES = ['tank', 'damage', 'support', 'open'];

// A carry-over player's numbers moving this long after a global rollover can
// only be new-season play (see season.mjs / rollup.mjs).
export const GRACE_MS = 36 * 60 * 60 * 1000;
// A reset that would start a new global season sooner than this after the last
// one is treated as a data glitch.
export const MIN_SEASON_MS = 21 * 24 * 60 * 60 * 1000;

// Counters take the day's MAX; the other career fields take the last value.
export const COUNTER_FIELDS = ['eliminations', 'deaths', 'assists', 'healingDone', 'gamesWon', 'gamesPlayed', 'timePlayed'];
export const CAREER_FIELDS = [...COUNTER_FIELDS, 'healingPer10Min', 'winPercentage'];

// Field types used by validate.mjs: 'string' | 'number' | 'int' | 'day', and a
// trailing '?' for nullable. Field order is the on-disk key order. `series`
// names the fields that identify a time series (daily datasets add `day`);
// `sort` is the on-disk row order, compared with plain `<`.
export const SEASON_DATASETS = {
  rankDaily: {
    file: 'rank-daily',
    kind: 'daily',
    series: ['player', 'role'],
    sort: ['day', 'player', 'role'],
    fields: { player: 'string', role: 'string', day: 'day', tier: 'number?', division: 'string?', season: 'int' },
  },
  careerDaily: {
    file: 'career-daily',
    kind: 'daily',
    series: ['player'],
    sort: ['day', 'player'],
    fields: {
      player: 'string', day: 'day', eliminations: 'number?', deaths: 'number?', assists: 'number?',
      gamesWon: 'number?', gamesPlayed: 'number?',
    },
  },
  careerHeroDaily: {
    file: 'career-hero-daily',
    kind: 'daily',
    series: ['player', 'hero'],
    sort: ['day', 'player', 'hero'],
    fields: {
      player: 'string', hero: 'string', day: 'day', eliminations: 'number?', deaths: 'number?',
      assists: 'number?', gamesPlayed: 'number?', timePlayed: 'number?',
    },
  },
  careerLatest: {
    file: 'career-latest',
    kind: 'latest',
    series: ['player', 'hero'],
    sort: ['player', 'hero'],
    fields: {
      player: 'string', hero: 'string', time: 'number', eliminations: 'number?', deaths: 'number?',
      assists: 'number?', healingDone: 'number?', healingPer10Min: 'number?', gamesWon: 'number?',
      gamesPlayed: 'number?', winPercentage: 'number?', timePlayed: 'number?',
    },
  },
};

// Global "now" files in snapshots/ (no `season` in the header).
export const GLOBAL_DATASETS = {
  rankCurrent: {
    file: 'rank-current',
    kind: 'latest',
    series: ['player', 'role'],
    sort: ['player', 'role'],
    fields: { player: 'string', role: 'string', time: 'number', tier: 'number?', division: 'string?', season: 'int?' },
  },
  profiles: {
    file: 'profiles',
    kind: 'latest',
    series: ['player'],
    sort: ['player'],
    fields: {
      player: 'string', time: 'number', username: 'string?', avatar: 'string?', namecard: 'string?',
      title: 'string?', endorsementLevel: 'number?', endorsementFrame: 'string?', lastUpdatedAt: 'number?',
    },
    // Added by V3; absent in files baked by the legacy fetch-snapshots.mjs.
    optional: ['lastUpdatedAt'],
  },
};
