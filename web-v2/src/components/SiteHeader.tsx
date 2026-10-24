import { useLocation } from 'react-router-dom';
import { useSelectedSeason } from '../hooks/useSelectedSeason';
import { getRuntimeConfig } from '../lib/runtimeConfig';
import SeasonLink from './SeasonLink';

export default function SiteHeader() {
  const location = useLocation();
  const isOverview = location.pathname === '/' || location.pathname === '';
  const isSettings = location.pathname === '/settings';
  const isOptimizer = location.pathname === '/optimizer';
  const cfg = getRuntimeConfig();
  const { season, currentSeason, seasons, setSeason } = useSelectedSeason();
  return (
    <header className="hero-shell">
      <p className="eyebrow">OW Live Report · V2</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3.4rem)' }}>{cfg.team.name}</h1>
        {!isOverview ? (
          <SeasonLink to="/" style={{ fontSize: '0.95rem' }}>← Team overview</SeasonLink>
        ) : null}
        <nav style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontSize: '0.85rem' }}>
          {seasons.length > 1 && season !== undefined ? (
            <select
              className="season-picker"
              aria-label="Season"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
            >
              {seasons.map((s) => (
                <option key={s.season} value={s.season}>
                  Season {s.season}{s.season === currentSeason ? ' (current)' : ''}
                </option>
              ))}
            </select>
          ) : null}
          {!isOptimizer ? (
            <SeasonLink to="/optimizer" style={{ color: 'var(--muted)' }}>Optimizer</SeasonLink>
          ) : null}
          {!isSettings ? (
            <SeasonLink to="/settings" style={{ color: 'var(--muted)' }}>Settings</SeasonLink>
          ) : null}
        </nav>
      </div>
      <p className="lede">{cfg.team.subtitle}</p>
    </header>
  );
}
