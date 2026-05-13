import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRoster } from '../hooks/useRoster';
import { fetchLatestPlayerProfile } from '../lib/queries/latestPlayerProfile';
import PlayerRankTrend from '../components/charts/PlayerRankTrend';
import PlayerKdaTrend from '../components/charts/PlayerKdaTrend';
import PlayerWinRateTrend from '../components/charts/PlayerWinRateTrend';
import RoleBreakdown from '../components/charts/RoleBreakdown';
import HeroUsageStacked from '../components/charts/HeroUsageStacked';
import HeroPerfLines from '../components/charts/HeroPerfLines';
import HeroLeaderboard from '../components/HeroLeaderboard';
import TrajectoryPanel from '../components/TrajectoryPanel';

function useHiddenHeroes(slug: string, adminDefaults: readonly string[] | undefined): {
  hidden: Set<string>;
  toggle: (hero: string) => void;
} {
  const storageKey = `owr-v2:hidden-heroes:${slug}`;
  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      // Admin defaults seed the initial state only when localStorage is
      // untouched. Once the user toggles anything (even back to empty),
      // an empty array is stored, and admin defaults are ignored
      // thereafter — the user owns their preferences.
      if (raw === null) return new Set(adminDefaults ?? []);
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set(adminDefaults ?? []);
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...hidden]));
    } catch {
      // ignore quota errors
    }
  }, [hidden, storageKey]);
  return {
    hidden,
    toggle: (hero) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(hero)) next.delete(hero);
        else next.add(hero);
        return next;
      });
    },
  };
}

export default function PlayerPage() {
  const { slug } = useParams<{ slug: string }>();
  const roster = useRoster();
  const player = useMemo(() => roster.data?.players.find((p) => p.slug === slug), [roster.data, slug]);
  const profile = useQuery({
    queryKey: ['player', 'profile', player?.playerId ?? ''],
    queryFn: () => fetchLatestPlayerProfile(player!.playerId),
    enabled: !!player,
  });
  const { hidden, toggle } = useHiddenHeroes(slug ?? '', player?.hiddenHeroes);

  if (roster.isLoading) return <div className="panel skeleton" style={{ minHeight: 300 }} />;
  if (!player) {
    return (
      <div className="panel">
        <h2>Player not found</h2>
        <p className="lede">No roster entry matched <code>{slug}</code>.</p>
        <Link to="/">Back to overview</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <section className="panel">
        <div className="player-header">
          <div
            className="avatar"
            style={profile.data?.avatar ? { backgroundImage: `url(${profile.data.avatar})` } : undefined}
            aria-hidden="true"
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h2>{player.display}</h2>
              {player.lockedRole ? (
                <span
                  className={`role-pill ${player.lockedRole}`}
                  title="Admin-set primary role from team.sample.json"
                >
                  {player.lockedRole}
                </span>
              ) : null}
            </div>
            <div style={{ color: 'var(--muted)' }}>{player.battleTag}</div>
            {player.notes ? <div style={{ marginTop: 4 }}>{player.notes}</div> : null}
            <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--muted)' }}>
              {profile.data?.endorsement !== null && profile.data?.endorsement !== undefined
                ? `Endorsement ${profile.data.endorsement}`
                : ''}
            </div>
          </div>
        </div>
      </section>

      <TrajectoryPanel playerId={player.playerId} displayName={player.display} />

      <section className="panel">
        <header className="section-head">
          <h2>Rank trend</h2>
          <p>Per role, last 90 days</p>
        </header>
        <PlayerRankTrend playerId={player.playerId} />
      </section>

      <div className="grid cols-2">
        <section className="panel">
          <header className="section-head"><h2>KDA</h2><p>Daily</p></header>
          <PlayerKdaTrend playerId={player.playerId} />
        </section>
        <section className="panel">
          <header className="section-head"><h2>Win rate</h2><p>Daily</p></header>
          <PlayerWinRateTrend playerId={player.playerId} />
        </section>
      </div>

      <section className="panel">
        <header className="section-head">
          <h2>Role breakdown</h2>
          <p>Aggregated from current-season per-hero stats via hero→role catalog</p>
        </header>
        <RoleBreakdown playerId={player.playerId} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Hero usage</h2>
          <p>Weekly current-season playtime snapshots, top heroes</p>
        </header>
        <HeroUsageStacked playerId={player.playerId} hiddenHeroes={hidden} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Hero performance</h2>
          <p>Weekly current-season KDA snapshots</p>
        </header>
        <HeroPerfLines playerId={player.playerId} hiddenHeroes={hidden} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Hero leaderboard</h2>
          <p>Current competitive season. 1-game 100%-WR outliers filtered.</p>
        </header>
        <HeroLeaderboard playerId={player.playerId} hiddenHeroes={hidden} onToggle={toggle} />
      </section>
    </div>
  );
}
