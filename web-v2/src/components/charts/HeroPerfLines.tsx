import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchPlayerHeroPerf } from '../../lib/queries/charts/player/heroPerf';
import { fetchPlayerHeroUsage } from '../../lib/queries/charts/player/heroUsage';

const COLORS = ['#59c2ff', '#41d8b7', '#ffb84f', '#ff7f73', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });

export default function HeroPerfLines({ battleTag, hiddenHeroes }: { battleTag: string; hiddenHeroes: Set<string> }) {
  const usage = useQuery({
    queryKey: ['player', 'heroUsage', battleTag],
    queryFn: () => fetchPlayerHeroUsage(battleTag),
  });
  const perf = useQuery({
    queryKey: ['player', 'heroPerf', battleTag],
    queryFn: () => fetchPlayerHeroPerf(battleTag),
  });

  const heroes = useMemo(
    () => (usage.data?.heroOrder ?? []).filter((h) => !hiddenHeroes.has(h.key)),
    [usage.data, hiddenHeroes],
  );

  const data = useMemo(() => {
    const heroSet = new Set(heroes.map((h) => h.key));
    return (perf.data ?? []).map((p) => {
      const row: Record<string, number | null> = { time: p.time };
      for (const [k, v] of Object.entries(p.byHero)) {
        if (heroSet.has(k)) row[k] = v;
      }
      return row;
    });
  }, [perf.data, heroes]);

  if (usage.isLoading || perf.isLoading) return <div className="skeleton chart-wrap tall" />;
  if (usage.isError || perf.isError) return <div className="error">Couldn't load hero performance.</div>;
  if (!data.length || !heroes.length) return <div className="empty">No hero performance data in window.</div>;

  return (
    <div className="chart-wrap tall">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="time" tickFormatter={fmtDate} stroke="var(--muted)" />
          <YAxis stroke="var(--muted)" domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleDateString()}
            formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : '—')}
          />
          <Legend wrapperStyle={{ color: 'var(--muted)' }} />
          {heroes.map((h, idx) => (
            <Line
              key={h.key}
              type="monotone"
              dataKey={h.key}
              name={h.pretty}
              stroke={COLORS[idx % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
