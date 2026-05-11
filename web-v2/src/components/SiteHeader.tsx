import { Link, useLocation } from 'react-router-dom';

const TEAM_NAME = import.meta.env.VITE_TEAM_NAME ?? 'Team';
const TEAM_SUBTITLE = import.meta.env.VITE_TEAM_SUBTITLE ?? 'Live competitive reporting.';
const LINK_TO_V1 = import.meta.env.VITE_LINK_TO_V1_URL ?? '../';

export default function SiteHeader() {
  const location = useLocation();
  const isOverview = location.pathname === '/' || location.pathname === '';
  return (
    <header className="hero-shell">
      <p className="eyebrow">OW Live Report · V2</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3.4rem)' }}>{TEAM_NAME}</h1>
        {!isOverview ? (
          <Link to="/" style={{ fontSize: '0.95rem' }}>← Team overview</Link>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--muted)' }}>
          <a href={LINK_TO_V1}>Back to V1</a>
        </span>
      </div>
      <p className="lede">{TEAM_SUBTITLE}</p>
    </header>
  );
}
