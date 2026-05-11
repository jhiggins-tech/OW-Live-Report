import { Link } from 'react-router-dom';
import type { RosterPlayer } from '../types/models';

export default function RosterGrid({ players }: { players: RosterPlayer[] }) {
  if (!players.length) {
    return <div className="empty">Roster is empty — check config/tracked-battletags.txt</div>;
  }
  return (
    <div className="grid cols-3">
      {players.map((p) => (
        <Link
          key={p.slug}
          to={`/players/${p.slug}`}
          className="roster-card"
          aria-label={`Open ${p.display} (${p.battleTag})`}
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          <div className="name">{p.display}</div>
          <div className="tag">{p.battleTag}</div>
          {p.notes ? <div className="notes">{p.notes}</div> : null}
        </Link>
      ))}
    </div>
  );
}
