import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchPlayerRankTrend } from '../../lib/queries/charts/player/rankTrend';
import { rankLabelFromOrdinal } from '../../lib/normalize/rankOrdinal';

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });

export default function PlayerRankTrend({ battleTag }: { battleTag: string }) {
  const query = useQuery({
    queryKey: ['player', 'rankTrend', battleTag],
    queryFn: () => fetchPlayerRankTrend(battleTag),
  });
  if (query.isLoading) return <div className="skeleton chart-wrap" />;
  if (query.isError) return <div className="error">Couldn't load rank trend.</div>;
  const data = (query.data ?? []).map((p) => ({
    time: p.time,
    tank: p.byRole.tank,
    damage: p.byRole.damage,
    support: p.byRole.support,
  }));
  if (!data.length) return <div className="empty">No competitive rank history.</div>;
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="time" tickFormatter={fmtDate} stroke="var(--muted)" />
          <YAxis
            stroke="var(--muted)"
            domain={[1, 40]}
            ticks={[5, 10, 15, 20, 25, 30, 35, 40]}
            tickFormatter={(v) => rankLabelFromOrdinal(Number(v))}
            width={110}
          />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            formatter={(v) => (typeof v === 'number' ? rankLabelFromOrdinal(v) : '—')}
          />
          <Legend wrapperStyle={{ color: 'var(--muted)' }} />
          <Line type="stepAfter" dataKey="tank" stroke="var(--role-tank)" strokeWidth={2} dot={false} connectNulls />
          <Line type="stepAfter" dataKey="damage" stroke="var(--role-damage)" strokeWidth={2} dot={false} connectNulls />
          <Line type="stepAfter" dataKey="support" stroke="var(--role-support)" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
