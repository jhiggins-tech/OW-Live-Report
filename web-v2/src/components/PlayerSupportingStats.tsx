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
        <h2>Current performance</h2>
        <p>Latest competitive all-heroes snapshot</p>
      </header>
      {query.isLoading ? (
        <div className="grid cols-4">
          {[0, 1, 2, 3].map((i) => (<div className="panel skeleton" key={i} style={{ minHeight: 96 }} />))}
        </div>
      ) : query.isError ? (
        <div className="error">Couldn't load performance stats: {(query.error as Error)?.message ?? 'unknown error'}</div>
      ) : (
        <div className="grid cols-4">
          <div className="stat-card">
            <div className="label">KDA</div>
            <div className="value">{query.data?.kda == null ? '—' : query.data.kda.toFixed(2)}</div>
            <div className="delta flat">(eliminations + assists) / deaths</div>
          </div>
          <div className="stat-card">
            <div className="label">Win rate</div>
            <div className="value">{query.data?.winRate == null ? '—' : `${query.data.winRate.toFixed(1)}%`}</div>
            <div className="delta flat">{formatCompact(query.data?.gamesPlayed ?? null)} games</div>
          </div>
          <div className="stat-card">
            <div className="label">A / Death</div>
            <div className="value">{query.data?.assistsPerDeath == null ? '—' : query.data.assistsPerDeath.toFixed(2)}</div>
            <div className="delta flat">{formatCompact(query.data?.assists ?? null)} assists</div>
          </div>
          <div className="stat-card">
            <div className="label">Heal / 10 min</div>
            <div className="value">{formatCompact(query.data?.healingPer10Min ?? null)}</div>
            <div className="delta flat">avg per 10 min</div>
          </div>
        </div>
      )}
    </section>
  );
}
