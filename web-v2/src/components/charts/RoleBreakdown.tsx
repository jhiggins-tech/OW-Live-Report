import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchPlayerRoleBreakdown } from '../../lib/queries/charts/player/roleBreakdown';

export default function RoleBreakdown({ battleTag }: { battleTag: string }) {
  const query = useQuery({
    queryKey: ['player', 'roleBreakdown', battleTag],
    queryFn: () => fetchPlayerRoleBreakdown(battleTag),
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load role breakdown.</div>;
  const data = (query.data ?? []).filter((r) => r.gamesPlayed && r.gamesPlayed > 0).map((r) => ({
    role: r.role,
    kda: r.kda,
    winRate: r.winRate,
    games: r.gamesPlayed,
  }));
  if (!data.length) return <div className="empty">No role data in window.</div>;
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="role" stroke="var(--muted)" />
          <YAxis yAxisId="left" stroke="var(--muted)" />
          <YAxis yAxisId="right" orientation="right" stroke="var(--muted)" domain={[0, 100]} unit="%" />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            formatter={(v, name) => {
              if (typeof v !== 'number') return v;
              if (name === 'winRate') return `${v.toFixed(1)}%`;
              if (name === 'kda') return v.toFixed(2);
              return v;
            }}
          />
          <Bar yAxisId="left" dataKey="kda" fill="var(--mint)" radius={[6, 6, 0, 0]} />
          <Bar yAxisId="right" dataKey="winRate" fill="var(--sky)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
