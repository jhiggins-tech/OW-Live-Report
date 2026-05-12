import { Link, useLocation } from 'react-router-dom';
import { getRuntimeConfig } from '../lib/runtimeConfig';

export default function SiteHeader() {
  const location = useLocation();
  const isOverview = location.pathname === '/' || location.pathname === '';
  const isSettings = location.pathname === '/settings';
  const isOptimizer = location.pathname === '/optimizer';
  const cfg = getRuntimeConfig();
  return (
    <header className="hero-shell">
      <p className="eyebrow">OW Live Report · V2</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3.4rem)' }}>{cfg.team.name}</h1>
        {!isOverview ? (
          <Link to="/" style={{ fontSize: '0.95rem' }}>← Team overview</Link>
        ) : null}
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: '0.85rem' }}>
          {!isOptimizer ? (
            <Link to="/optimizer" style={{ color: 'var(--muted)' }}>Optimizer</Link>
          ) : null}
          {!isSettings ? (
            <Link to="/settings" style={{ color: 'var(--muted)' }}>Settings</Link>
          ) : null}
        </nav>
      </div>
      <p className="lede">{cfg.team.subtitle}</p>
    </header>
  );
}
