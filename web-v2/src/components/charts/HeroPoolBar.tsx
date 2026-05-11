import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchTeamHeroPool } from '../../lib/queries/charts/team/heroPool';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

function fmtHours(seconds: number): string {
  const hrs = seconds / 3600;
  if (hrs < 1) return `${Math.round(seconds / 60)}m`;
  return `${hrs.toFixed(1)}h`;
}

export default function HeroPoolBar({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'heroPool', hashPlayerSet(players)],
    queryFn: () => fetchTeamHeroPool(players),
    enabled: players.length > 0,
  });
  if (query.isLoading) return <div className="skeleton chart-wrap tall" />;
  if (query.isError) return <div className="error">Couldn't load hero pool.</div>;
  const data = (query.data ?? []).slice(0, 15).map((h) => ({ name: h.prettyName, hours: h.timePlayedSeconds / 3600 }));
  if (!data.length) return <div className="empty">No hero playtime in window.</div>;
  return (
    <div className="chart-wrap tall">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis type="number" stroke="var(--muted)" tickFormatter={(v) => `${v.toFixed(0)}h`} />
          <YAxis type="category" dataKey="name" stroke="var(--muted)" width={110} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            formatter={(v) => (typeof v === 'number' ? fmtHours(v * 3600) : v)}
          />
          <Bar dataKey="hours" fill="var(--amber)" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
