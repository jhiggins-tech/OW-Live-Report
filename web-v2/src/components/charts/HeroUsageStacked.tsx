import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchPlayerHeroUsage } from '../../lib/queries/charts/player/heroUsage';

const COLORS = ['#59c2ff', '#41d8b7', '#ffb84f', '#ff7f73', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });

export default function HeroUsageStacked({ battleTag, hiddenHeroes }: { battleTag: string; hiddenHeroes: Set<string> }) {
  const query = useQuery({
    queryKey: ['player', 'heroUsage', battleTag],
    queryFn: () => fetchPlayerHeroUsage(battleTag),
  });

  const data = useMemo(() => {
    if (!query.data) return [];
    return query.data.points.map((p) => {
      const row: Record<string, number> = { time: p.time };
      for (const [key, val] of Object.entries(p.byHero)) {
        if (hiddenHeroes.has(key)) continue;
        row[key] = Math.round(val / 60);
      }
      return row;
    });
  }, [query.data, hiddenHeroes]);

  if (query.isLoading) return <div className="skeleton chart-wrap tall" />;
  if (query.isError) return <div className="error">Couldn't load hero usage.</div>;
  if (!data.length) return <div className="empty">No hero playtime in window.</div>;

  const heroes = (query.data?.heroOrder ?? []).filter((h) => !hiddenHeroes.has(h.key));

  return (
    <div className="chart-wrap tall">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(145, 177, 214, 0.14)" />
          <XAxis dataKey="time" tickFormatter={fmtDate} stroke="var(--muted)" />
          <YAxis stroke="var(--muted)" tickFormatter={(v) => `${v}m`} />
          <Tooltip
            contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', borderRadius: 12 }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleDateString()}
            formatter={(v) => (typeof v === 'number' ? `${v}m` : v) as React.ReactNode}
            itemSorter={(i) => -(Number(i.value) || 0)}
          />
          <Legend wrapperStyle={{ color: 'var(--muted)' }} />
          {heroes.map((h, idx) => (
            <Area
              key={h.key}
              type="monotone"
              dataKey={h.key}
              name={h.pretty}
              stackId="1"
              stroke={COLORS[idx % COLORS.length]}
              fill={COLORS[idx % COLORS.length]}
              fillOpacity={0.5}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
