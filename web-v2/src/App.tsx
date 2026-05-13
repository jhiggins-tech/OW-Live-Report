import { Outlet } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';
import StaleBanner from './components/StaleBanner';
import HeroMetaBanner from './components/HeroMetaBanner';

export default function App() {
  return (
    <>
      <SiteHeader />
      <StaleBanner />
      <HeroMetaBanner />
      <main className="page-shell">
        <Outlet />
      </main>
    </>
  );
}
