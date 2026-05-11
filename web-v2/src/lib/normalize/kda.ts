export function kdaFrom(eliminations: number | null | undefined, assists: number | null | undefined, deaths: number | null | undefined): number | null {
  if (eliminations === null || eliminations === undefined) return null;
  if (assists === null || assists === undefined) return null;
  if (deaths === null || deaths === undefined) return null;
  const safeDeaths = Math.max(Number(deaths), 1);
  return (Number(eliminations) + Number(assists)) / safeDeaths;
}

export function safeNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}
