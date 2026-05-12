import { Link } from 'react-router-dom';
import type { RosterPlayer } from '../types/models';
import type { TrajectoryResult } from '../lib/trajectory';

interface Props {
  players: RosterPlayer[];
  trajectoryByPlayerId?: Record<string, TrajectoryResult>;
}

const LABEL_TONE: Record<string, 'support' | 'damage' | 'tank'> = {
  up: 'support',
  down: 'damage',
  flat: 'tank',
};
const LABEL_TEXT: Record<string, string> = {
  up: '↑ trending up',
  down: '↓ trending down',
  flat: '· stable',
};

export default function RosterGrid({ players, trajectoryByPlayerId }: Props) {
  if (!players.length) {
    return <div className="empty">Roster is empty — check config/tracked-battletags.txt</div>;
  }
  return (
    <div className="grid cols-3">
      {players.map((p) => {
        const traj = trajectoryByPlayerId?.[p.playerId];
        return (
          <Link
            key={p.slug}
            to={`/players/${p.slug}`}
            className="roster-card"
            aria-label={`Open ${p.display} (${p.battleTag})`}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span className="name">{p.display}</span>
              {traj && traj.signals.length > 0 ? (
                <span className={`role-pill ${LABEL_TONE[traj.label]}`} style={{ fontSize: '0.7rem' }}>
                  {LABEL_TEXT[traj.label]}
                </span>
              ) : null}
            </div>
            <div className="tag">{p.battleTag}</div>
            {p.notes ? (
              <div className="notes">
                {p.notes
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map((token) => (
                    <span key={token} className="note-badge">{token}</span>
                  ))}
              </div>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
