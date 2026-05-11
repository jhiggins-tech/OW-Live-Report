import { Outlet } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';

export default function App() {
  return (
    <>
      <SiteHeader />
      <main className="page-shell">
        <Outlet />
      </main>
    </>
  );
}
