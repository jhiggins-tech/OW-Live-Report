import { useQuery } from '@tanstack/react-query';
import { fetchTeamWideMatch } from '../lib/queries/teamWideMatch';
import { rankLabelFromOrdinal } from '../lib/normalize/rankOrdinal';
import { hashPlayerSet } from '../lib/queries/_shared';
import type { RosterPlayer } from '../types/models';

export default function WideMatchBanner({ players }: { players: RosterPlayer[] }) {
  const query = useQuery({
    queryKey: ['team', 'wideMatch', hashPlayerSet(players)],
    queryFn: () => fetchTeamWideMatch(players),
    enabled: players.length > 0,
  });

  if (query.isLoading) {
    return <div className="skeleton" style={{ height: 64 }} />;
  }
  if (query.isError) {
    return <div className="error">Couldn't assess wide-match status.</div>;
  }
  const data = query.data;
  if (!data) return null;

  const { assessment, perPlayer } = data;
  const ranked = perPlayer.filter((p) => p.bestOrdinal !== null);
  const top = ranked.reduce((a, b) => ((a?.bestOrdinal ?? -1) > (b.bestOrdinal ?? -1) ? a : b), ranked[0]);
  const bottom = ranked.reduce((a, b) => ((a?.bestOrdinal ?? Infinity) < (b.bestOrdinal ?? Infinity) ? a : b), ranked[0]);

  const labelTone = assessment.label === 'wide'
    ? 'damage'
    : assessment.label === 'narrow'
      ? 'support'
      : 'tank';
  const labelText = assessment.label === 'unknown' ? 'Unknown' : assessment.label === 'wide' ? 'Wide group' : 'Narrow group';

  return (
    <section
      className="panel"
      style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
    >
      <span className={`role-pill ${labelTone}`} style={{ fontSize: '0.82rem' }}>{labelText}</span>
      <span style={{ flex: 1, color: 'var(--muted)', fontSize: '0.95rem' }}>
        {assessment.reason}
      </span>
      {assessment.spreadDivisions !== null && top && bottom ? (
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Spread {assessment.spreadDivisions} divs · {bottom.player.display}{' '}
          {rankLabelFromOrdinal(bottom.bestOrdinal)} → {top.player.display}{' '}
          {rankLabelFromOrdinal(top.bestOrdinal)}
        </span>
      ) : null}
      <a
        href={assessment.sourceUrl}
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: '0.8rem' }}
      >
        rules
      </a>
    </section>
  );
}
