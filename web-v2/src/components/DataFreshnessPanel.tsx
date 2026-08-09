import { useSnapshotMeta } from '../hooks/useSnapshotMeta';
import { useNowTick } from '../hooks/useNowTick';
import { formatRelative } from '../lib/formatRelativeTime';

function formatAbsolute(time: number | null): string {
  if (time === null || !Number.isFinite(time)) return 'unknown';
  return new Date(time).toLocaleString();
}

export default function DataFreshnessPanel() {
  const meta = useSnapshotMeta();
  const now = useNowTick();

  const heartbeatAt = meta.data?.heartbeatAt ?? null;
  const generatedAt = meta.data?.generatedAt ?? null;

  return (
    <section className="panel">
      <header className="section-head">
        <h2>Data pipeline</h2>
        <p>
          An upstream scraper polls the OverFast API roughly every six hours (it is
          aggressively rate limited); CI bakes its output into static snapshots hourly.
        </p>
      </header>
      {meta.isLoading ? (
        <div className="panel skeleton" style={{ minHeight: 90 }} />
      ) : meta.isError ? (
        <div className="error">
          Couldn't load snapshot metadata: {(meta.error as Error)?.message ?? 'unknown error'}
        </div>
      ) : (
        <div className="grid cols-4">
          <div className="panel stat-card">
            <div className="label">Last OverFast hit</div>
            <div className="value" style={{ fontSize: '1.6rem' }}>
              {formatRelative(heartbeatAt, now)}
            </div>
            <div className="delta flat">{formatAbsolute(heartbeatAt)}</div>
          </div>
          <div className="panel stat-card">
            <div className="label">Snapshots baked (CI)</div>
            <div className="value" style={{ fontSize: '1.6rem' }}>
              {formatRelative(generatedAt, now)}
            </div>
            <div className="delta flat">{formatAbsolute(generatedAt)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
