import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchSupportingStats } from '../../lib/queries/supportingStats';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

function fmtCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

export default function TeamHealingChart({ players }: { players: RosterPlayer[] }) {
  // Shares the query key with the roster supporting-stats fetch, so the
  // Overview page resolves both from a single Influx round-trip.
  const query = useQuery({
    queryKey: ['team', 'supportingStats', hashPlayerSet(players)],
    queryFn: () => fetchSupportingStats(players.map((p) => p.playerId)),
    enabled: players.length > 0,
  });

  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load healing stats.</div>;

  const data = players
    .map((p) => ({ name: p.display, heal: query.data?.get(p.playerId)?.healingPer10Min ?? null }))
    .filter((d): d is { name: string; heal: number } => d.heal !== null)
    .sort((a, b) => b.heal - a.heal);
  if (!data.length) return <div className="empty">No healing data available.</div>;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="name" stroke="var(--muted)" interval={0} />
          <YAxis stroke="var(--muted)" tickFormatter={(v) => fmtCompact(Number(v))} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            formatter={(v) => (typeof v === 'number' ? fmtCompact(v) : v)}
          />
          <Bar dataKey="heal" fill="var(--sky)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
