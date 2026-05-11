import { useEffect, useState } from 'react';
import { STALE_DATA_EVENT, type StaleDataEventDetail } from '../lib/influxClient';

interface StaleNotice {
  oldestAgeMs: number;
  newestAgeMs: number;
  count: number;
  lastError: string;
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  const days = Math.round(hours / 24);
  return `${days}d old`;
}

export default function StaleBanner() {
  const [notice, setNotice] = useState<StaleNotice | null>(null);

  useEffect(() => {
    const onStale = (e: Event) => {
      const detail = (e as CustomEvent<StaleDataEventDetail>).detail;
      if (!detail) return;
      setNotice((prev) => {
        if (!prev) {
          return {
            oldestAgeMs: detail.ageMs,
            newestAgeMs: detail.ageMs,
            count: 1,
            lastError: detail.error.message,
          };
        }
        return {
          oldestAgeMs: Math.max(prev.oldestAgeMs, detail.ageMs),
          newestAgeMs: Math.min(prev.newestAgeMs, detail.ageMs),
          count: prev.count + 1,
          lastError: detail.error.message,
        };
      });
    };
    window.addEventListener(STALE_DATA_EVENT, onStale);
    return () => window.removeEventListener(STALE_DATA_EVENT, onStale);
  }, []);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: 'rgba(255, 184, 79, 0.14)',
        border: '1px solid rgba(255, 184, 79, 0.4)',
        color: 'var(--amber)',
        borderRadius: 14,
        padding: '10px 16px',
        margin: '12px clamp(16px, 4vw, 44px) 0',
        maxWidth: 1280,
        marginLeft: 'auto',
        marginRight: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        fontSize: '0.9rem',
      }}
    >
      <strong>Showing cached data.</strong>
      <span style={{ color: 'var(--muted)' }}>
        Live InfluxDB queries failed; falling back to data {formatAge(notice.newestAgeMs)}
        {notice.count > 1 ? ` (oldest ${formatAge(notice.oldestAgeMs)})` : ''}.
      </span>
      <button
        onClick={() => setNotice(null)}
        style={{ marginLeft: 'auto' }}
        aria-label="Dismiss stale-data notice"
      >
        Dismiss
      </button>
    </div>
  );
}
