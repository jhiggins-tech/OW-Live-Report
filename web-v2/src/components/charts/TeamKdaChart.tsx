import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchTeamKdaOverTime } from '../../lib/queries/charts/team/kdaOverTime';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

function formatDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

export default function TeamKdaChart({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'kdaOverTime', hashPlayerSet(players)],
    queryFn: () => fetchTeamKdaOverTime(players),
    enabled: players.length > 0,
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load team KDA.</div>;
  const data = (query.data ?? []).map((p) => ({ time: p.time, kda: p.teamKda }));
  if (!data.length) return <div className="empty">No KDA data in window.</div>;
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="time" tickFormatter={formatDate} stroke="var(--muted)" />
          <YAxis stroke="var(--muted)" domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : v)}
          />
          <Line type="monotone" dataKey="kda" stroke="var(--mint)" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
