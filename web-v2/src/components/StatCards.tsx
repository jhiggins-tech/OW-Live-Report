import { useQuery } from '@tanstack/react-query';
import { fetchTeamStatCards } from '../lib/queries/charts/team/statCards';
import { hashPlayerSet } from '../lib/queries/_shared';
import type { RosterPlayer } from '../types/models';

function formatRelative(time: number | null): string {
  if (time === null) return 'no data';
  const delta = Date.now() - time;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
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
        {[0, 1, 2, 3].map((i) => (<div className="panel skeleton" key={i} />))}
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
        <div className="value">{d.teamKda === null ? '—' : d.teamKda.toFixed(2)}</div>
        <div className="delta flat">last({'14d'})</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Team win rate</div>
        <div className="value">{d.teamWinRate === null ? '—' : `${d.teamWinRate.toFixed(1)}%`}</div>
        <div className="delta flat">competitive</div>
      </div>
      <div className="panel stat-card">
        <div className="label">Newest snapshot</div>
        <div className="value" style={{ fontSize: '1.6rem' }}>{formatRelative(d.newestSeenAt)}</div>
        <div className="delta flat">player_summary</div>
      </div>
    </div>
  );
}
