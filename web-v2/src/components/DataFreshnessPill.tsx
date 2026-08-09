import { useSnapshotMeta } from '../hooks/useSnapshotMeta';
import { useNowTick } from '../hooks/useNowTick';
import { formatRelative } from '../lib/formatRelativeTime';

// The upstream scraper hits OverFast roughly every six hours, so one healthy
// cycle plus an hour of slack still counts as fresh; past two cycles the
// pipeline is presumed stuck.
const FRESH_MS = 7 * 60 * 60 * 1000;
const AGING_MS = 12 * 60 * 60 * 1000;

export default function DataFreshnessPill() {
  const meta = useSnapshotMeta();
  const now = useNowTick();

  if (meta.isLoading) return null;

  const heartbeatAt = meta.data?.heartbeatAt ?? null;
  const generatedAt = meta.data?.generatedAt ?? null;

  if (meta.isError || (heartbeatAt === null && generatedAt === null)) {
    const label = 'Could not load snapshot metadata';
    return (
      <span className="freshness-pill unknown" title={label} aria-label={label}>
        <span className="dot" /> data status unknown
      </span>
    );
  }

  const tooltip = [
    heartbeatAt !== null && Number.isFinite(heartbeatAt)
      ? `OverFast last hit: ${new Date(heartbeatAt).toLocaleString()}`
      : 'OverFast last hit: unknown',
    generatedAt !== null && Number.isFinite(generatedAt)
      ? `Snapshots baked: ${new Date(generatedAt).toLocaleString()}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (heartbeatAt === null || !Number.isFinite(heartbeatAt)) {
    return (
      <span className="freshness-pill unknown" title={tooltip} aria-label={tooltip}>
        <span className="dot" /> no heartbeat
      </span>
    );
  }

  const age = Math.max(0, now - heartbeatAt);
  const tier = age < FRESH_MS ? 'fresh' : age < AGING_MS ? 'aging' : 'stale';
  return (
    <span className={`freshness-pill ${tier}`} title={tooltip} aria-label={tooltip}>
      <span className="dot" /> data {formatRelative(heartbeatAt, now)}
    </span>
  );
}
