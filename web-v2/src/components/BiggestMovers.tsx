import { Link } from 'react-router-dom';
import { useTeamTrajectories } from '../hooks/useTeamTrajectories';
import type { TrajectoryResult } from '../lib/trajectory';
import type { RosterPlayer } from '../types/models';

interface RankedMover {
  player: RosterPlayer;
  traj: TrajectoryResult;
  magnitude: number;
}

const LABEL_TONE: Record<string, 'support' | 'damage' | 'tank'> = {
  up: 'support',
  down: 'damage',
  flat: 'tank',
};
const LABEL_TEXT: Record<string, string> = {
  up: 'Trending up',
  down: 'Trending down',
  flat: 'Stable',
};

export default function BiggestMovers({ players }: { players: RosterPlayer[] }) {
  const { byPlayerId, isLoading, isError } = useTeamTrajectories(players);

  if (isLoading) return <div className="skeleton" style={{ minHeight: 160 }} />;
  if (isError) return <div className="error">Couldn't compute movers.</div>;

  // Rank players by composite-score magnitude × confidence so a confident
  // small mover beats a noisy big mover.
  const ranked: RankedMover[] = players
    .map((p): RankedMover | null => {
      const tr = byPlayerId[p.playerId];
      if (!tr || tr.signals.length === 0) return null;
      return { player: p, traj: tr, magnitude: Math.abs(tr.compositeScore) * Math.max(0.3, tr.confidence) };
    })
    .filter((x): x is RankedMover => x !== null)
    .sort((a, b) => b.magnitude - a.magnitude);

  const movers = ranked.slice(0, 3);
  const upCount = Object.values(byPlayerId).filter((t) => t.label === 'up').length;
  const downCount = Object.values(byPlayerId).filter((t) => t.label === 'down').length;
  const flatCount = Object.values(byPlayerId).filter((t) => t.label === 'flat').length;

  if (movers.length === 0) {
    return (
      <section className="panel">
        <header className="section-head">
          <h2>Biggest movers</h2>
          <p>Per-player short-window trajectory</p>
        </header>
        <div className="empty">Not enough recent data to pick movers yet.</div>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="section-head" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h2>Biggest movers</h2>
        <p>
          {upCount} up · {flatCount} stable · {downCount} down
        </p>
      </header>
      <div className="grid cols-3">
        {movers.map(({ player, traj }) => (
          <div key={player.slug} className="panel" style={{ background: 'var(--panel-strong)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <Link to={`/players/${player.slug}`} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}>
                {player.display}
              </Link>
              <span className={`role-pill ${LABEL_TONE[traj.label]}`}>{LABEL_TEXT[traj.label]}</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 6 }}>
              {traj.forecast} · confidence {Math.round(traj.confidence * 100)}%
            </div>
            <p style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--muted)' }}>
              {traj.narrative}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
