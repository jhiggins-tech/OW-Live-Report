import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useRoster } from '../hooks/useRoster';
import { useHiddenPlayers } from '../hooks/useHiddenPlayers';
import { fetchOptimizerData } from '../lib/queries/optimizerData';
import { buildCandidates, optimizeLineup, type LineupAssignment } from '../lib/optimizer';
import { hashPlayerSet } from '../lib/queries/_shared';
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

function AssignmentCard({ a }: { a: LineupAssignment }) {
  return (
    <div className="panel" style={{ background: 'var(--panel-strong)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Link
          to={`/players/${a.player.slug}`}
          style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}
        >
          {a.player.display}
        </Link>
        <span className={`role-pill ${a.role}`}>{a.role}</span>
        {a.locked ? (
          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>locked</span>
        ) : null}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 6 }}>
        {a.option.rankLabel} · {a.option.kda.toFixed(2)} KDA · {fmtPercent(a.option.winRate)} win
      </div>
      {a.option.explanation ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: 6 }}>
          {a.option.explanation}
        </div>
      ) : null}
      <div style={{ marginTop: 8, fontSize: '0.82rem' }}>
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
              <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                team KDA {result.lineup.teamKda.toFixed(2)} · team win {fmtPercent(result.lineup.teamWinRate)} · score {result.lineup.totalScore.toFixed(3)}
              </span>
            </div>
            <div className="grid cols-3">
              {result.lineup.assignments.map((a) => (
                <AssignmentCard key={a.player.slug} a={a} />
              ))}
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
