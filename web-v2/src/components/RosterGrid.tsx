import { Link } from 'react-router-dom';
import type { PlayerStatPoint, RosterPlayer } from '../types/models';
import type { TrajectoryResult } from '../lib/trajectory';
import type { OverFastPlayerSummary } from '../lib/queries/overfastPlayerSummary';

interface Props {
  players: RosterPlayer[];
  trajectoryByPlayerId?: Record<string, TrajectoryResult>;
  profileByPlayerId?: Record<string, OverFastPlayerSummary>;
  statByPlayerId?: Record<string, PlayerStatPoint>;
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

function fmtKda(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

function fmtWinRate(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '—';
}

export default function RosterGrid({
  players,
  trajectoryByPlayerId,
  profileByPlayerId,
  statByPlayerId,
}: Props) {
  if (!players.length) {
    return <div className="empty">Roster is empty — check config/tracked-battletags.txt</div>;
  }
  return (
    <div className="grid cols-3">
      {players.map((p) => {
        const traj = trajectoryByPlayerId?.[p.playerId];
        const profile = profileByPlayerId?.[p.playerId];
        const stats = statByPlayerId?.[p.playerId];
        return (
          <Link
            key={p.slug}
            to={`/players/${p.slug}`}
            className="roster-card"
            aria-label={`Open ${p.display} (${p.battleTag})`}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {profile?.avatar ? (
              <img className="roster-card-avatar" src={profile.avatar} alt="" loading="lazy" />
            ) : null}
            <div className="roster-card-main">
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
            </div>
            <div className="roster-card-stats" aria-label={`${p.display} KDA and win rate`}>
              <div className="roster-card-stat">
                <span>KDA</span>
                <strong>{fmtKda(stats?.kda)}</strong>
              </div>
              <div className="roster-card-stat">
                <span>Win</span>
                <strong>{fmtWinRate(stats?.winRate)}</strong>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
