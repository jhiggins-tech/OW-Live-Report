// Runtime config: a small JSON document fetched once on app boot so we can
// change non-secret operational values (team name, query URL, ...) without
// rebuilding the SPA. The build step generates docs/data/runtime-config.json
// from environment variables; see scripts/build-runtime-config.mjs.

export interface RuntimeConfig {
  team: {
    name: string;
    subtitle: string;
  };
  ui: {
    topHeroCount: number;
  };
  influx: {
    queryUrl: string;
    database: string;
    gamemode: string;
  };
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  team: {
    name: 'Team',
    subtitle: 'Live competitive reporting.',
  },
  ui: {
    topHeroCount: 6,
  },
  influx: {
    queryUrl: 'https://owstats.jhiggins.tech/query',
    database: 'ow_stats_telegraf',
    gamemode: 'competitive',
  },
};

let cached: RuntimeConfig = DEFAULT_CONFIG;
let loaded = false;

function deepMerge(base: RuntimeConfig, override: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    team: { ...base.team, ...(override.team ?? {}) },
    ui: { ...base.ui, ...(override.ui ?? {}) },
    influx: { ...base.influx, ...(override.influx ?? {}) },
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (loaded) return cached;
  const url = `${import.meta.env.BASE_URL}data/runtime-config.json`.replace(/\/+/g, '/');
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) {
      const partial = (await res.json()) as Partial<RuntimeConfig>;
      cached = deepMerge(DEFAULT_CONFIG, partial);
    }
  } catch {
    // fall back to defaults; missing config is non-fatal
  }
  loaded = true;
  return cached;
}

export function getRuntimeConfig(): RuntimeConfig {
  return cached;
}
