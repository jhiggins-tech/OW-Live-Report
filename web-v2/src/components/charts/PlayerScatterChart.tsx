import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { fetchPlayerScatter } from '../../lib/queries/charts/team/playerScatter';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

const PLAYER_COLORS = [
  '#59c2ff',
  '#ff7f73',
  '#41d8b7',
  '#ffb84f',
  '#b690ff',
  '#f06bc4',
  '#8bd450',
  '#ff9f5a',
  '#68e7ff',
  '#d5e85b',
];

export default function PlayerScatterChart({ players }: { players: RosterPlayer[] }) {
  const colorBySlug = useMemo(() => {
    const m = new Map<string, string>();
    players.forEach((p, i) => {
      m.set(p.slug, PLAYER_COLORS[i % PLAYER_COLORS.length]!);
    });
    return m;
  }, [players]);

  const query = useQuery({
    queryKey: ['team', 'playerScatter', hashPlayerSet(players)],
    queryFn: () => fetchPlayerScatter(players),
    enabled: players.length > 0,
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load player scatter.</div>;
  const points = (query.data ?? []).filter((p) => p.kda !== null && p.winRate !== null);
  const coloredPoints = points.map((p) => ({
    ...p,
    color: colorBySlug.get(p.slug) ?? PLAYER_COLORS[0]!,
  }));
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
            <Scatter data={coloredPoints}>
              {coloredPoints.map((p) => (
                <Cell
                  key={p.slug}
                  fill={p.color}
                  stroke={p.color}
                  strokeOpacity={0.9}
                  fillOpacity={0.86}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="scatter-legend">
        {coloredPoints.map((p) => (
          <Link key={p.slug} to={`/players/${p.slug}`} className="scatter-legend-item">
            <span
              className="scatter-legend-swatch"
              style={{ backgroundColor: p.color, borderColor: p.color }}
              aria-hidden="true"
            />
            {p.display}
          </Link>
        ))}
      </div>
    </>
  );
}
