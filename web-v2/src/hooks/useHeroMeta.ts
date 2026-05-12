import { useQuery } from '@tanstack/react-query';
import { fetchHeroMeta, type HeroMeta } from '../lib/queries/heroMeta';

const ONE_HOUR = 60 * 60 * 1000;

export function useHeroMeta() {
  return useQuery<HeroMeta>({
    queryKey: ['overfast', 'heroMeta'],
    queryFn: fetchHeroMeta,
    // Pickrates/winrates change on the order of patches, not minutes. Keep
    // the cache hot for an hour in-session; OverFast itself caches /heroes
    // for a day on their CDN.
    staleTime: ONE_HOUR,
    gcTime: 24 * ONE_HOUR,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
