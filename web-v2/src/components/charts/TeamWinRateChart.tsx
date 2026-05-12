import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchTeamWinRateOverTime } from '../../lib/queries/charts/team/winRateOverTime';
import { hashPlayerSet } from '../../lib/queries/_shared';
import type { RosterPlayer } from '../../types/models';

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });

export default function TeamWinRateChart({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'winRateOverTime', hashPlayerSet(players)],
    queryFn: () => fetchTeamWinRateOverTime(players),
    enabled: players.length > 0,
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load team win rate.</div>;
  const data = (query.data ?? []).map((p) => ({ time: p.time, wr: p.teamWinRate }));
  if (!data.length) return <div className="empty">No win-rate data in window.</div>;
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="time" tickFormatter={fmtDate} stroke="var(--muted)" />
          <YAxis stroke="var(--muted)" domain={[0, 100]} unit="%" />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : v)}
          />
          <Line type="monotone" dataKey="wr" stroke="var(--sky)" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
