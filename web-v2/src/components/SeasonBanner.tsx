import { Link } from 'react-router-dom';
import { useSelectedSeason } from '../hooks/useSelectedSeason';

const fmtDay = (ms: number, withYear: boolean) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

// Shown under the header while a past season is selected. Styled like the
// stale-data banners, in the sky accent since it is informational.
export default function SeasonBanner() {
  const { season, isCurrent, seasons } = useSelectedSeason();
  const info = seasons.find((s) => s.season === season);
  if (isCurrent || !info) return null;

  const sameYear = new Date(info.firstDay).getUTCFullYear() === new Date(info.lastDay).getUTCFullYear();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: 'rgba(89, 194, 255, 0.12)',
        border: '1px solid rgba(89, 194, 255, 0.4)',
        color: 'var(--sky)',
        borderRadius: 14,
        padding: '8px 16px',
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
      <strong>Viewing Season {info.season}</strong>
      <span style={{ color: 'var(--muted)' }}>
        ({fmtDay(info.firstDay, !sameYear)} – {fmtDay(info.lastDay, true)})
      </span>
      <Link to={{ search: '' }} replace style={{ marginLeft: 'auto' }}>Back to current season</Link>
    </div>
  );
}
