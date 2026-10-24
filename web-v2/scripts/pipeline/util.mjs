// Small pure helpers shared by the pipeline modules.

export const DAY_MS = 86_400_000;

// Epoch ms of the UTC midnight at or before `ms` (the roll-up day bucket).
export function utcDay(ms) {
  return ms - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

// Plain `<` ordering over the named keys. localeCompare is avoided on purpose
// so the on-disk order is identical on every machine.
export function compareBy(keys) {
  return (a, b) => {
    for (const k of keys) {
      if (a[k] < b[k]) return -1;
      if (a[k] > b[k]) return 1;
    }
    return 0;
  };
}

// Coerce an API value to a finite number, or null when absent/non-numeric.
export function toNumber(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// `YYYY-MM-DD` for log lines and test names.
export function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
