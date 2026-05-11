import { useRoster } from '../hooks/useRoster';
import StatCards from '../components/StatCards';
import RosterGrid from '../components/RosterGrid';
import TeamKdaChart from '../components/charts/TeamKdaChart';
import TeamWinRateChart from '../components/charts/TeamWinRateChart';
import TeamRankChart from '../components/charts/TeamRankChart';
import PlayerScatterChart from '../components/charts/PlayerScatterChart';
import HeroPoolBar from '../components/charts/HeroPoolBar';

export default function OverviewPage() {
  const roster = useRoster();
  if (roster.isLoading) {
    return <div className="panel skeleton" style={{ minHeight: 300 }} />;
  }
  if (roster.isError) {
    return <div className="error">Couldn't load roster: {(roster.error as Error)?.message ?? 'unknown'}</div>;
  }
  const players = roster.data?.players ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <StatCards players={players} />

      <section className="panel">
        <header className="section-head">
          <h2>Team KDA over time</h2>
          <p>Daily mean across roster, last 90 days</p>
        </header>
        <TeamKdaChart players={players} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Team win rate over time</h2>
          <p>Daily mean across roster, last 90 days</p>
        </header>
        <TeamWinRateChart players={players} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Team rank progression</h2>
          <p>Mean ordinal per role, daily snapshots</p>
        </header>
        <TeamRankChart players={players} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Player scatter — KDA × Win rate</h2>
          <p>Last 7 days, point size = games played</p>
        </header>
        <PlayerScatterChart players={players} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Team hero pool</h2>
          <p>Top heroes by team playtime, last 90 days</p>
        </header>
        <HeroPoolBar players={players} />
      </section>

      <section className="panel">
        <header className="section-head">
          <h2>Roster</h2>
          <p>{players.length} players</p>
        </header>
        <RosterGrid players={players} />
      </section>
    </div>
  );
}
