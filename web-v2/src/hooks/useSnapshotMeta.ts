import { useQuery } from '@tanstack/react-query';
import { loadMeta } from '../lib/snapshotClient';
import type { SnapshotMeta } from '../types/snapshots';

const FIVE_MINUTES = 5 * 60 * 1000;

export function useSnapshotMeta() {
  return useQuery<SnapshotMeta>({
    queryKey: ['snapshots', 'meta'],
    queryFn: loadMeta,
    // snapshotClient serves its own cache below five minutes of age, so
    // this interval is the earliest a refetch can actually hit the network.
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
