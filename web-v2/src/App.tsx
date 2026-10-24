import { Outlet } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';
import SeasonBanner from './components/SeasonBanner';
import StaleBanner from './components/StaleBanner';
import HeroMetaBanner from './components/HeroMetaBanner';
import { useSelectedSeason } from './hooks/useSelectedSeason';

export default function App() {
  // Pages read the selected season from the URL, which only resolves once
  // meta has loaded; hold them back so no query fires against a guess.
  const { ready } = useSelectedSeason();
  return (
    <>
      <SiteHeader />
      <SeasonBanner />
      <StaleBanner />
      <HeroMetaBanner />
      <main className="page-shell">
        {ready ? <Outlet /> : <div className="panel skeleton" style={{ minHeight: 300 }} />}
      </main>
    </>
  );
}
