import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DOCS_DATA = fileURLToPath(new URL('../docs/data/', import.meta.url));

// Dev only: serve docs/data/{snapshots,seasons}/ straight from the
// committed tree instead of copying it into public/.
function serveCommittedData(): Plugin {
  return {
    name: 'owr-serve-committed-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const m = path.match(/^\/OW-Live-Report\/data\/((?:snapshots|seasons)\/.+\.json)$/);
        if (!m) return next();
        const file = resolve(DOCS_DATA, m[1]!);
        if (!file.startsWith(DOCS_DATA) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'application/json');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveCommittedData()],
  base: '/OW-Live-Report/',
  build: {
    outDir: '../docs',
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
