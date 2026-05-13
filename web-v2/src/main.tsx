import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

import App from './App';
import OverviewPage from './pages/OverviewPage';
import PlayerPage from './pages/PlayerPage';
import SettingsPage from './pages/SettingsPage';
import OptimizerPage from './pages/OptimizerPage';
import NotFoundPage from './pages/NotFoundPage';
import { loadRuntimeConfig } from './lib/runtimeConfig';

import './theme/tokens.css';
import './theme/global.css';

const STALE = 5 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE,
      gcTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Bump the version suffix whenever the cached data shape changes; doing so
// invalidates any sessionStorage caches that pre-date the schema change.
const persister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
  key: 'owr-v2:react-query:v2',
  throttleTime: 1000,
});

// Rewrite legacy hash bookmarks (`/#/players/kie`) to canonical paths
// (`/OW-Live-Report/players/kie`) before the router reads location.
if (typeof window !== 'undefined' && window.location.hash.startsWith('#/')) {
  const target = window.location.hash.slice(2); // strip '#/'
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  window.history.replaceState(null, '', `${base}/${target}`);
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
      children: [
        { index: true, element: <OverviewPage /> },
        { path: 'players/:slug', element: <PlayerPage /> },
        { path: 'optimizer', element: <OptimizerPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

// Wait for runtime-config.json before mounting so any module that calls
// getRuntimeConfig() at render time sees the loaded values, not defaults.
await loadRuntimeConfig();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: STALE }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
