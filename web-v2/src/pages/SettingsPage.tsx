import { Link } from 'react-router-dom';
import { useRoster } from '../hooks/useRoster';
import { useHiddenPlayers } from '../hooks/useHiddenPlayers';

export default function SettingsPage() {
  const roster = useRoster();
  const { hidden, toggle, restoreAll } = useHiddenPlayers();

  if (roster.isLoading) return <div className="panel skeleton" style={{ minHeight: 200 }} />;
  if (roster.isError) {
    return <div className="error">Couldn't load roster: {(roster.error as Error)?.message ?? 'unknown'}</div>;
  }
  const players = roster.data?.players ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section className="panel">
        <header className="section-head">
          <h2>Snapshot visibility</h2>
          <p>Hide players from team-wide views. Stored in your browser only.</p>
        </header>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            {hidden.size} hidden · {players.length - hidden.size} visible
          </span>
          <button onClick={restoreAll} disabled={hidden.size === 0} aria-disabled={hidden.size === 0}>
            Restore all
          </button>
        </div>
        <table className="leaderboard">
          <thead>
            <tr>
              <th>Player</th>
              <th>BattleTag</th>
              <th>Notes</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const isHidden = hidden.has(p.slug);
              return (
                <tr key={p.slug} style={{ opacity: isHidden ? 0.55 : 1 }}>
                  <td>
                    <Link to={`/players/${p.slug}`} style={{ color: 'inherit' }}>
                      {p.display}
                    </Link>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{p.battleTag}</td>
                  <td style={{ color: 'var(--muted)' }}>{p.notes ?? ''}</td>
                  <td>
                    <span className={`role-pill ${isHidden ? 'damage' : 'support'}`}>
                      {isHidden ? 'Hidden' : 'Visible'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => toggle(p.slug)} aria-pressed={isHidden}>
                      {isHidden ? 'Show' : 'Hide'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>About</h2>
          <p>V2 reads live from InfluxDB. All preferences are stored in your browser.</p>
        </header>
        <p className="lede" style={{ marginTop: 0 }}>
          Hidden players are excluded from the team overview's stat cards, KDA / win-rate / rank
          trends, player scatter, and team hero pool, but their individual pages remain
          accessible from this list.
        </p>
      </section>
    </div>
  );
}
