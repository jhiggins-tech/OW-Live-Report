// Shared relative-time formatting. Two phrasings exist historically:
// banners describe an age ("42m old") while stat readouts describe a
// point in time ("42m ago").

function describe(ms: number, suffix: string): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ${suffix}`;
  const days = Math.round(hours / 24);
  return `${days}d ${suffix}`;
}

export function formatAge(ms: number): string {
  return describe(ms, 'old');
}

export function formatRelative(time: number | null, now = Date.now()): string {
  if (time === null || !Number.isFinite(time)) return 'no data';
  return describe(Math.max(0, now - time), 'ago');
}
