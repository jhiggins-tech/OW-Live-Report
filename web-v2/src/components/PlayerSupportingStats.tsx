import { useQuery } from '@tanstack/react-query';
import { fetchSupportingStats } from '../lib/queries/supportingStats';

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

export default function PlayerSupportingStats({ playerId }: { playerId: string }) {
  const query = useQuery({
    queryKey: ['player', 'supportingStats', playerId],
    queryFn: async () => (await fetchSupportingStats([playerId])).get(playerId) ?? null,
    enabled: playerId.length > 0,
  });

  return (
    <section className="panel">
      <header className="section-head">
        <h2>Supporting stats</h2>
        <p>Career totals across all heroes, competitive</p>
      </header>
      {query.isLoading ? (
        <div className="grid cols-3">
          {[0, 1, 2].map((i) => (<div className="panel skeleton" key={i} style={{ minHeight: 96 }} />))}
        </div>
      ) : query.isError ? (
        <div className="error">Couldn't load supporting stats: {(query.error as Error)?.message ?? 'unknown error'}</div>
      ) : (
        <div className="grid cols-3">
          <div className="stat-card">
            <div className="label">Assists per death</div>
            <div className="value">{query.data?.assistsPerDeath == null ? '—' : query.data.assistsPerDeath.toFixed(2)}</div>
            <div className="delta flat">{formatCompact(query.data?.assists ?? null)} assists</div>
          </div>
          <div className="stat-card">
            <div className="label">Heal / 10 min</div>
            <div className="value">{formatCompact(query.data?.healingPer10Min ?? null)}</div>
            <div className="delta flat">avg per 10 min</div>
          </div>
          <div className="stat-card">
            <div className="label">Healing done</div>
            <div className="value">{formatCompact(query.data?.healingDone ?? null)}</div>
            <div className="delta flat">career total</div>
          </div>
        </div>
      )}
    </section>
  );
}
