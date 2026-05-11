import { useQuery } from '@tanstack/react-query';
import type { Roster } from '../types/models';

const ROSTER_URL = `${import.meta.env.BASE_URL}data/roster.json`.replace(/\/+/g, '/');

async function fetchRoster(): Promise<Roster> {
  const res = await fetch(ROSTER_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Roster fetch failed: HTTP ${res.status}`);
  return res.json() as Promise<Roster>;
}

export function useRoster() {
  return useQuery({
    queryKey: ['roster'],
    queryFn: fetchRoster,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}
