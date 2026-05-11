import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useRoster } from '../hooks/useRoster';
import { useHiddenPlayers } from '../hooks/useHiddenPlayers';
import { useHeroMeta } from '../hooks/useHeroMeta';
import { useTeamPlayerProfiles } from '../hooks/useTeamPlayerProfiles';
import { fetchOptimizerData, type PlayerHeroStat, type PlayerOptimizerData } from '../lib/queries/optimizerData';
import { buildCandidates, optimizeLineup, type LineupAssignment } from '../lib/optimizer';
import { hashPlayerSet } from '../lib/queries/_shared';
import type { HeroMeta } from '../lib/queries/heroMeta';
import type { OverFastPlayerSummary } from '../lib/queries/overfastPlayerSummary';
import type { Role, RosterPlayer } from '../types/models';

const ROLE_OPTIONS: Array<{ value: Role | 'auto' | 'bench'; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'tank', label: 'Tank' },
  { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' },
  { value: 'bench', label: 'Bench' },
];

type LockMap = Record<string, Role | 'auto' | 'bench'>;

function fmtPercent(v: number): string {
  return `${v.toFixed(1)}%`;
}

function fmtPickrate(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(0)}%`;
}

function HeroHeader() {
  return (
    <div className="lineup-card-hero-row lineup-card-hero-header">
      <span aria-hidden="true" />
      <span>Hero</span>
      <span className="lineup-card-hero-stat" title="Games played">G</span>
      <span className="lineup-card-hero-stat" title="Hero win rate">Win</span>
      <span className="lineup-card-hero-stat lineup-card-hero-pick" title="Player pickrate within role">Pick</span>
    </div>
  );
}

function HeroRow({ hero, heroMeta }: { hero: PlayerHeroStat; heroMeta: HeroMeta | undefined }) {
  const entry = heroMeta?.byKey[hero.hero];
  const portrait = entry?.portrait;
  const name = entry?.name ?? hero.prettyName;
  return (
    <div className="lineup-card-hero-row">
      {portrait ? (
        <img className="hero-portrait" src={portrait} alt="" loading="lazy" width={20} height={20} />
      ) : (
        <span className="hero-portrait hero-portrait--empty" aria-hidden="true" />
      )}
      <span className="lineup-card-hero-name">{name}</span>
      <span className="lineup-card-hero-stat" title="Games played">
        {hero.gamesPlayed}
      </span>
      <span className="lineup-card-hero-stat" title="Hero win rate">
        {hero.winRate === null ? '—' : `${hero.winRate.toFixed(0)}%`}
      </span>
      <span className="lineup-card-hero-stat lineup-card-hero-pick" title="Player pickrate within role">
        {fmtPickrate(hero.pickRate)}
      </span>
    </div>
  );
}

function AssignmentCard({
  a,
  heroes,
  profile,
  heroMeta,
}: {
  a: LineupAssignment;
  heroes: PlayerHeroStat[];
  profile: OverFastPlayerSummary | undefined;
  heroMeta: HeroMeta | undefined;
}) {
  const competitive = profile?.competitive[a.role];
  const avatar = profile?.avatar;
  return (
    <div className="panel lineup-card" style={{ background: 'var(--panel-strong)' }}>
      <div className="lineup-card-header">
        {avatar ? (
          <img className="lineup-card-avatar" src={avatar} alt="" loading="lazy" />
        ) : (
          <span className="lineup-card-avatar lineup-card-avatar--empty" aria-hidden="true" />
        )}
        <div className="lineup-card-identity">
          <Link
            to={`/players/${a.player.slug}`}
            className="lineup-card-name"
          >
            {a.player.display}
          </Link>
          <div className="lineup-card-meta">
            <span className={`role-pill ${a.role}`}>
              {competitive?.roleIcon ? (
                <img src={competitive.roleIcon} alt="" loading="lazy" />
              ) : null}
              {a.role}
            </span>
            {a.locked ? <span className="lineup-card-locked">locked</span> : null}
          </div>
        </div>
        {competitive?.rankIcon ? (
          <div className="lineup-card-rank" title={`${a.option.rankLabel} — division ${competitive.tier ?? '?'}`}>
            <img className="lineup-card-rank-icon" src={competitive.rankIcon} alt="" loading="lazy" />
            {competitive.tierIcon ? (
              <img className="lineup-card-tier-icon" src={competitive.tierIcon} alt="" loading="lazy" />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="lineup-card-stats">
        {a.option.rankLabel} · {a.option.kda.toFixed(2)} KDA · {fmtPercent(a.option.winRate)} win
      </div>
      {a.option.explanation ? (
        <div className="lineup-card-explanation">{a.option.explanation}</div>
      ) : null}
      <div className="lineup-card-heroes">
        {heroes.length === 0 ? (
          <div className="lineup-card-heroes-empty">No recent games on this role.</div>
        ) : (
          <>
            <HeroHeader />
            {heroes.map((h) => <HeroRow key={h.hero} hero={h} heroMeta={heroMeta} />)}
          </>
        )}
      </div>
      <div className="lineup-card-score">
        score <strong>{a.option.score.toFixed(3)}</strong>
      </div>
    </div>
  );
}

export default function OptimizerPage() {
  const roster = useRoster();
  const { hidden } = useHiddenPlayers();
  const visible: RosterPlayer[] = useMemo(
    () => (roster.data?.players ?? []).filter((p) => !hidden.has(p.slug)),
    [roster.data, hidden],
  );

  const [locks, setLocks] = useState<LockMap>({});

  const query = useQuery({
    queryKey: ['team', 'optimizerData', hashPlayerSet(visible)],
    queryFn: () => fetchOptimizerData(visible),
    enabled: visible.length > 0,
  });
  const profiles = useTeamPlayerProfiles(visible);
  const heroMeta = useHeroMeta();

  const heroesByPlayerAndRole = useMemo(() => {
    const m = new Map<string, PlayerOptimizerData['heroesByRole']>();
    for (const d of query.data ?? []) m.set(d.player.playerId, d.heroesByRole);
    return m;
  }, [query.data]);

  const result = useMemo(() => {
    if (!query.data) return null;
    const benched = new Set(
      Object.entries(locks).filter(([, v]) => v === 'bench').map(([slug]) => slug),
    );
    const pool = query.data.filter((d) => !benched.has(d.player.slug));
    const candidates = buildCandidates(pool);
    const roleLocks: Record<string, Role | null> = {};
    for (const [slug, value] of Object.entries(locks)) {
      if (value === 'auto' || value === 'bench') continue;
      roleLocks[slug] = value;
    }
    return optimizeLineup(candidates, { roleLocks });
  }, [query.data, locks]);

  if (roster.isLoading || query.isLoading) {
    return <div className="panel skeleton" style={{ minHeight: 360 }} />;
  }
  if (roster.isError) {
    return <div className="error">Couldn't load roster.</div>;
  }
  if (query.isError) {
    return <div className="error">Couldn't load optimizer data.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <section className="panel">
        <header className="section-head">
          <h2>Suggested lineup</h2>
          <p>1 Tank · 2 Damage · 2 Support — picked from {visible.length} visible players</p>
        </header>
        {!result || !result.lineup ? (
          <div className="empty">
            Couldn't build a full five-player lineup with the current locks and visibility.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
              <span
                className={`role-pill ${result.lineup.wideAssessment.label === 'wide' ? 'damage' : result.lineup.wideAssessment.label === 'narrow' ? 'support' : 'tank'}`}
                title={result.lineup.wideAssessment.reason}
              >
                {result.lineup.wideAssessment.label === 'unknown' ? 'Wide check unknown' : `${result.lineup.wideAssessment.label} group`}
              </span>
              {result.lineup.wideAssessment.spreadDivisions !== null ? (
                <span
                  style={{ color: 'var(--muted)', fontSize: '0.9rem' }}
                  title={
                    result.lineup.wideAssessment.threshold !== null
                      ? `Wide threshold: ${result.lineup.wideAssessment.threshold} divisions`
                      : undefined
                  }
                >
                  spread {result.lineup.wideAssessment.spreadDivisions.toFixed(1)} divisions
                </span>
              ) : null}
              <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                team KDA {result.lineup.teamKda.toFixed(2)} · team win {fmtPercent(result.lineup.teamWinRate)} · score {result.lineup.totalScore.toFixed(3)}
              </span>
            </div>
            <div className="grid cols-3">
              {result.lineup.assignments.map((a) => {
                const heroes = heroesByPlayerAndRole.get(a.player.playerId)?.[a.role] ?? [];
                const profile = profiles.byPlayerId[a.player.playerId];
                return (
                  <AssignmentCard
                    key={a.player.slug}
                    a={a}
                    heroes={heroes}
                    profile={profile}
                    heroMeta={heroMeta.data}
                  />
                );
              })}
            </div>
          </>
        )}
        {result?.warnings.length ? (
          <ul style={{ marginTop: 18, color: 'var(--warn)', fontSize: '0.88rem' }}>
            {result.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Role locks</h2>
          <p>Override the optimizer per player. Locks apply only to this session.</p>
        </header>
        <table className="leaderboard">
          <thead>
            <tr>
              <th>Player</th>
              <th>Admin lock</th>
              <th>This session</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const current = locks[p.slug] ?? 'auto';
              return (
                <tr key={p.slug}>
                  <td>
                    <Link to={`/players/${p.slug}`} style={{ color: 'inherit' }}>{p.display}</Link>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{p.lockedRole ?? '—'}</td>
                  <td>
                    <div role="group" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      {ROLE_OPTIONS.map((opt) => {
                        const selected = current === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setLocks((prev) => ({ ...prev, [p.slug]: opt.value }))}
                            aria-pressed={selected}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
