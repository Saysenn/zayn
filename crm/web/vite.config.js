import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend-only build step — output lands where Express serves static files
// from, so the built dashboard and the API stay one deployable, per the plan.
export default defineConfig({
  plugins: [react()],
  // three is reachable only behind lazy() (the two orbs), so dev never sees it
  // on the initial crawl: it re-optimises mid import and the chunk fetch dies.
  optimizeDeps: {
    include: ['three'],
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: '../api/public',
    emptyOutDir: true,
  },
});
