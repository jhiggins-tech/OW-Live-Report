import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchTeamHealingByHero } from '../../lib/queries/charts/team/healingByHero';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

function fmtCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

export default function TeamHealingChart({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'healingByHero', hashPlayerSet(players)],
    queryFn: () => fetchTeamHealingByHero(players),
    enabled: players.length > 0,
  });

  if (query.isLoading) return <div className="skeleton chart-wrap tall" />;
  if (query.isError) return <div className="error">Couldn't load healing stats.</div>;

  const data = query.data ?? [];
  if (!data.length) return <div className="empty">No healing data available.</div>;

  return (
    <div className="chart-wrap tall">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 24, bottom: 96, left: 8 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis
            dataKey="label"
            stroke="var(--muted)"
            interval={0}
            angle={-45}
            textAnchor="end"
            height={96}
            tick={{ fontSize: 11 }}
          />
          <YAxis stroke="var(--muted)" tickFormatter={(v) => fmtCompact(Number(v))} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            formatter={(v) => (typeof v === 'number' ? fmtCompact(v) : v)}
          />
          <Bar dataKey="healingPer10Min" fill="var(--sky)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
