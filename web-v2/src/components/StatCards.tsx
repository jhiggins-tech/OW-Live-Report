import { useQuery } from '@tanstack/react-query';
import { fetchTeamStatCards } from '../lib/queries/charts/team/statCards';
import { hashPlayerSet } from '../lib/queries/_shared';
import { formatRelative } from '../lib/formatRelativeTime';
import type { RosterPlayer } from '../types/models';

function formatCompact(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

export default function StatCards({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'statCards', hashPlayerSet(players)],
    queryFn: () => fetchTeamStatCards(players),
    enabled: players.length > 0,
  });

  if (query.isLoading) {
    return (
      <div className="grid cols-4">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (<div className="panel skeleton" key={i} />))}
      </div>
    );
  }
  if (query.isError) {
    return <div className="error">Couldn't load team stats: {(query.error as Error)?.message ?? 'unknown error'}</div>;
  }
  const d = query.data;
  if (!d) return null;

  return (
    <div className="grid cols-4">
      <div className="panel stat-card">
        <div className="label">Tracked players</div>
        <div className="value">{d.trackedPlayers}</div>
        <div className="delta flat">{d.freshPlayers} fresh in 14d</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Team avg KDA</div>
        <div className="value">{d.teamKda == null ? '—' : d.teamKda.toFixed(2)}</div>
        <div className="delta flat">last({'14d'})</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Team win rate</div>
        <div className="value">{d.teamWinRate == null ? '—' : `${d.teamWinRate.toFixed(1)}%`}</div>
        <div className="delta flat">competitive</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Team avg assists/death</div>
        <div className="value">{d.teamAssistsPerDeath == null ? '—' : d.teamAssistsPerDeath.toFixed(2)}</div>
        <div className="delta flat">all heroes</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Team avg heal / 10 min</div>
        <div className="value">{formatCompact(d.teamHealingPer10Min)}</div>
        <div className="delta flat">all heroes</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Team healing done</div>
        <div className="value">{formatCompact(d.teamHealingDone)}</div>
        <div className="delta flat">career total</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Newest snapshot</div>
        <div className="value" style={{ fontSize: '1.6rem' }}>{formatRelative(d.newestSeenAt)}</div>
        <div className="delta flat">player_summary</div>
      </div>
    </div>
  );
}
