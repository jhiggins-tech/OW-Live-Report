import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { fetchPlayerScatter } from '../../lib/queries/charts/team/playerScatter';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

export default function PlayerScatterChart({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'playerScatter', hashPlayerSet(players)],
    queryFn: () => fetchPlayerScatter(players),
    enabled: players.length > 0,
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load player scatter.</div>;
  const points = (query.data ?? []).filter((p) => p.kda !== null && p.winRate !== null);
  if (!points.length) return <div className="empty">No player data in last 7 days.</div>;

  return (
    <>
      <div className="chart-wrap">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
            <XAxis
              type="number"
              dataKey="kda"
              name="KDA"
              stroke="var(--muted)"
              domain={['auto', 'auto']}
              label={{ value: 'KDA', position: 'insideBottom', offset: -6, fill: 'var(--muted)' }}
            />
            <YAxis
              type="number"
              dataKey="winRate"
              name="Win rate"
              stroke="var(--muted)"
              domain={[0, 100]}
              unit="%"
              label={{ value: 'Win %', angle: -90, position: 'insideLeft', fill: 'var(--muted)' }}
            />
            <ZAxis type="number" dataKey="gamesPlayed" range={[60, 280]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
              formatter={(value, name) => {
                if (name === 'KDA' && typeof value === 'number') return value.toFixed(2);
                if (name === 'Win rate' && typeof value === 'number') return `${value.toFixed(1)}%`;
                return value;
              }}
              labelFormatter={(_v, payload) => {
                const display = payload?.[0]?.payload?.display ?? '';
                return display;
              }}
            />
            <Scatter data={points} fill="var(--sky)" stroke="var(--mint)" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {points.map((p) => (
          <Link key={p.slug} to={`/players/${p.slug}`} style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {p.display}
          </Link>
        ))}
      </div>
    </>
  );
}
