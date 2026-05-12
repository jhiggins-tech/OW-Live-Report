import { Outlet } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';
import StaleBanner from './components/StaleBanner';

export default function App() {
  return (
    <>
      <SiteHeader />
      <StaleBanner />
      <main className="page-shell">
        <Outlet />
      </main>
    </>
  );
}
