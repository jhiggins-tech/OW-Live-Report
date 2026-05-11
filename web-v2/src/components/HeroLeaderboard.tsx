import { useQuery } from '@tanstack/react-query';
import { fetchPlayerHeroLeaderboard } from '../lib/queries/charts/player/heroLeaderboard';

function fmtHours(seconds: number): string {
  const hrs = seconds / 3600;
  if (hrs < 1) return `${Math.round(seconds / 60)}m`;
  return `${hrs.toFixed(1)}h`;
}

export default function HeroLeaderboard({
  playerId,
  hiddenHeroes,
  onToggle,
}: {
  playerId: string;
  hiddenHeroes: Set<string>;
  onToggle: (hero: string) => void;
}) {
  const query = useQuery({
    queryKey: ['player', 'heroLeaderboard', playerId],
    queryFn: () => fetchPlayerHeroLeaderboard(playerId),
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load hero leaderboard.</div>;
  const rows = query.data ?? [];
  if (!rows.length) return <div className="empty">No hero data in window.</div>;

  return (
    <table className="leaderboard">
      <thead>
        <tr>
          <th>Hero</th>
          <th>Games</th>
          <th>Win%</th>
          <th>KDA</th>
          <th>Time</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const hidden = hiddenHeroes.has(row.hero);
          return (
            <tr key={row.hero} style={{ opacity: hidden ? 0.4 : 1 }}>
              <td>{row.prettyName}</td>
              <td>{row.gamesPlayed}</td>
              <td>{row.winRate === null ? '—' : `${row.winRate.toFixed(1)}%`}</td>
              <td>{row.kda === null ? '—' : row.kda.toFixed(2)}</td>
              <td>{fmtHours(row.timePlayedSeconds)}</td>
              <td>
                <button onClick={() => onToggle(row.hero)} aria-pressed={hidden}>
                  {hidden ? 'Show' : 'Hide'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
