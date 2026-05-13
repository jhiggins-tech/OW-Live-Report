import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRoster } from '../hooks/useRoster';
import { useHiddenPlayers } from '../hooks/useHiddenPlayers';
import { useTeamTrajectories } from '../hooks/useTeamTrajectories';
import { useTeamPlayerProfiles } from '../hooks/useTeamPlayerProfiles';
import StatCards from '../components/StatCards';
import RosterGrid from '../components/RosterGrid';
import WideMatchBanner from '../components/WideMatchBanner';
import BiggestMovers from '../components/BiggestMovers';
import TeamKdaChart from '../components/charts/TeamKdaChart';
import TeamWinRateChart from '../components/charts/TeamWinRateChart';
import TeamRankChart from '../components/charts/TeamRankChart';
import PlayerScatterChart from '../components/charts/PlayerScatterChart';
import HeroPoolBar from '../components/charts/HeroPoolBar';
import { fetchPlayerScatter } from '../lib/queries/charts/team/playerScatter';
import { hashPlayerSet } from '../lib/queries/_shared';

export default function OverviewPage() {
  const roster = useRoster();
  const { hidden } = useHiddenPlayers();

  const visible = useMemo(
    () => (roster.data?.players ?? []).filter((p) => !hidden.has(p.slug)),
    [roster.data, hidden],
  );

  // Piggy-backs on the same three queries the team trend charts already fire,
  // so no extra Influx work.
  const { byPlayerId: trajectoryByPlayerId } = useTeamTrajectories(visible);
  const profiles = useTeamPlayerProfiles(visible);
  const scatterStats = useQuery({
    queryKey: ['team', 'playerScatter', hashPlayerSet(visible)],
    queryFn: () => fetchPlayerScatter(visible),
    enabled: visible.length > 0,
  });
  const scatterStatsByPlayerId = useMemo(() => {
    const byPlayerId: Record<string, NonNullable<typeof scatterStats.data>[number]> = {};
    for (const stat of scatterStats.data ?? []) {
      byPlayerId[stat.player] = stat;
    }
    return byPlayerId;
  }, [scatterStats.data]);

  if (roster.isLoading) {
    return <div className="panel skeleton" style={{ minHeight: 300 }} />;
  }
  if (roster.isError) {
    return <div className="error">Couldn't load roster: {(roster.error as Error)?.message ?? 'unknown'}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <StatCards players={visible} />

      <WideMatchBanner players={visible} />

      <BiggestMovers players={visible} />

      <section className="panel">
        <header className="section-head">
          <h2>Team KDA over time</h2>
          <p>Daily mean across roster, last 90 days</p>
        </header>
        <TeamKdaChart players={visible} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Team win rate over time</h2>
          <p>Daily mean across roster, last 90 days</p>
        </header>
        <TeamWinRateChart players={visible} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Team rank progression</h2>
          <p>Mean ordinal per role, daily snapshots</p>
        </header>
        <TeamRankChart players={visible} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Player scatter — KDA × Win rate</h2>
          <p>Last 7 days, point size = games played</p>
        </header>
        <PlayerScatterChart players={visible} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Team hero pool</h2>
          <p>Top heroes by current-season team playtime</p>
        </header>
        <HeroPoolBar players={visible} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Roster</h2>
          <p>
            {visible.length} of {roster.data?.players.length ?? 0} visible
            {hidden.size > 0 ? (
              <>
                {' · '}
                <Link to="/settings">manage hidden</Link>
              </>
            ) : null}
          </p>
        </header>
        <RosterGrid
          players={visible}
          trajectoryByPlayerId={trajectoryByPlayerId}
          profileByPlayerId={profiles.byPlayerId}
          statByPlayerId={scatterStatsByPlayerId}
        />
      </section>
    </div>
  );
}
