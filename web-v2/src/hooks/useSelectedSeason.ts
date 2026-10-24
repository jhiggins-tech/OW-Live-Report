import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { loadMeta } from '../lib/snapshotClient';

const SEASON_PARAM = 'season';

export interface SeasonInfo {
  season: number;
  firstDay: number;
  lastDay: number;
}

export interface SelectedSeason {
  // Season every snapshot query reads. Undefined on the legacy flat layout
  // (or an empty store), where the loaders ignore it.
  season: number | undefined;
  isCurrent: boolean;
  currentSeason: number | undefined;
  // Newest first; empty unless meta uses the per-season layout.
  seasons: SeasonInfo[];
  // False until meta has loaded (or failed). App holds the routes back until
  // then so no query runs against a season that is still unresolved.
  ready: boolean;
  // Updates the URL in place; the current season drops the param.
  setSeason: (season: number) => void;
}

// The `season` search param (absent = current season), validated against
// meta.seasons. Anything invalid falls back to the current season, and meta
// without layoutVersion 2 has no seasons to pick from.
export function useSelectedSeason(): SelectedSeason {
  const [params, setParams] = useSearchParams();
  const meta = useQuery({ queryKey: ['snapshot', 'meta'], queryFn: loadMeta });

  const data = meta.data;
  const seasons = useMemo<SeasonInfo[]>(
    () => (data?.layoutVersion === 2 ? [...(data.seasons ?? [])].sort((a, b) => b.season - a.season) : []),
    [data],
  );
  const currentSeason = data?.layoutVersion === 2 ? data.currentSeason ?? undefined : undefined;

  const raw = params.get(SEASON_PARAM);
  const requested = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const season =
    requested !== null && seasons.some((s) => s.season === requested) ? requested : currentSeason;

  const setSeason = useCallback(
    (next: number) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === currentSeason) out.delete(SEASON_PARAM);
          else out.set(SEASON_PARAM, String(next));
          return out;
        },
        { replace: true },
      );
    },
    [setParams, currentSeason],
  );

  return {
    season,
    isCurrent: season === currentSeason,
    currentSeason,
    seasons,
    ready: !meta.isPending,
    setSeason,
  };
}
