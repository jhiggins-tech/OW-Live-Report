import { useHeroMeta } from '../hooks/useHeroMeta';
import { formatAge } from '../lib/formatRelativeTime';

export default function HeroMetaBanner() {
  const { data } = useHeroMeta();
  if (!data || data.status === 'live') return null;

  const isStale = data.status === 'stale-cache';
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
      <strong>{isStale ? 'Showing cached hero meta.' : 'Hero meta unavailable.'}</strong>
      <span style={{ color: 'var(--muted)' }}>
        {isStale
          ? `OverFast /heroes/stats is unreachable; pickrate and win-rate columns are populated from cache (${formatAge(data.cacheAgeMs ?? 0)}).`
          : 'OverFast /heroes/stats is unreachable and no cache is available on this device. Meta Win% and Pick% will be blank until OverFast recovers.'}
      </span>
    </div>
  );
}
