import { Link, useLocation } from 'react-router-dom';

const TEAM_NAME = import.meta.env.VITE_TEAM_NAME ?? 'Team';
const TEAM_SUBTITLE = import.meta.env.VITE_TEAM_SUBTITLE ?? 'Live competitive reporting.';
const LINK_TO_V1 = import.meta.env.VITE_LINK_TO_V1_URL ?? '../';

export default function SiteHeader() {
  const location = useLocation();
  const isOverview = location.pathname === '/' || location.pathname === '';
  const isSettings = location.pathname === '/settings';
  return (
    <header className="hero-shell">
      <p className="eyebrow">OW Live Report · V2</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3.4rem)' }}>{TEAM_NAME}</h1>
        {!isOverview ? (
          <Link to="/" style={{ fontSize: '0.95rem' }}>← Team overview</Link>
        ) : null}
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: '0.85rem' }}>
          {!isSettings ? (
            <Link to="/settings" style={{ color: 'var(--muted)' }}>Settings</Link>
          ) : null}
          <a href={LINK_TO_V1} style={{ color: 'var(--muted)' }}>Back to V1</a>
        </nav>
      </div>
      <p className="lede">{TEAM_SUBTITLE}</p>
    </header>
  );
}
