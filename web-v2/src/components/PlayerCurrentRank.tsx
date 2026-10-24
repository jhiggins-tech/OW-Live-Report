import { useQuery } from '@tanstack/react-query';
import { fetchCurrentPlayerRanks } from '../lib/queries/currentPlayerRanks';
import { loadRankIcons } from '../lib/snapshotClient';
import type { Role } from '../types/models';
import { useSelectedSeason } from '../hooks/useSelectedSeason';
import RankInsignia from './RankInsignia';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

const ROLE_LABEL: Record<Role, string> = {
  tank: 'Tank',
  damage: 'Damage',
  support: 'Support',
};

function formatSnapshotDate(time: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(time));
}

export default function PlayerCurrentRank({ playerId }: { playerId: string }) {
  const { season } = useSelectedSeason();
  const query = useQuery({
    queryKey: ['player', 'currentRanks', playerId, season],
    queryFn: () => fetchCurrentPlayerRanks(playerId, season),
    enabled: playerId.length > 0,
  });
  // The insignia are looked up by tier name and number, so the key has no
  // season: past seasons' ranks get the same badges. Never rejects (an
  // older deploy without the file just gets empty maps).
  const icons = useQuery({ queryKey: ['snapshot', 'rankIcons'], queryFn: loadRankIcons });

  return (
    <section className="panel player-ranks">
      <header className="section-head">
        <h2>Competitive ranks</h2>
        <p>Latest recorded rank for each role</p>
      </header>

      {query.isLoading || icons.isLoading ? (
        <div className="player-rank-grid" aria-label="Loading competitive ranks">
          {ROLES.map((role) => (
            <div className="player-rank-card skeleton" key={role} />
          ))}
        </div>
      ) : query.isError ? (
        <div className="error">
          Couldn't load competitive ranks: {(query.error as Error)?.message ?? 'unknown error'}
        </div>
      ) : (
        <div className="player-rank-grid">
          {ROLES.map((role) => {
            const rank = query.data?.[role] ?? null;
            const detail = rank
              ? [
                  rank.season === null ? null : `Season ${rank.season}`,
                  formatSnapshotDate(rank.updatedAt),
                ].filter(Boolean).join(' · ')
              : 'No rank recorded';

            return (
              <article
                className={`player-rank-card ${role}`}
                key={role}
                aria-label={`${ROLE_LABEL[role]} rank: ${rank?.label ?? 'Unranked'}`}
              >
                <div className="player-rank-role">
                  <span className="player-rank-role-dot" aria-hidden="true" />
                  {ROLE_LABEL[role]}
                </div>
                <div className="player-rank-main">
                  <div className="player-rank-value">{rank?.label ?? 'Unranked'}</div>
                  {rank ? (
                    <RankInsignia division={rank.division} tier={rank.tier} label={rank.label} icons={icons.data} />
                  ) : null}
                </div>
                <div className="player-rank-detail">{detail}</div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
