import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import fs from 'node:fs';

/** Dev only: lists local-tracks/*.json for the editor's Open menu (the folder is git-ignored and never shipped). */
const localTracksIndex: Plugin = {
  name: 'local-tracks-index',
  configureServer(server) {
    server.middlewares.use('/__local-tracks', (_req, res) => {
      const names = fs.existsSync('local-tracks') ? fs.readdirSync('local-tracks').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(names));
    });
  },
};

export default defineConfig({
  plugins: [localTracksIndex],
  server: {
    port: 5197,
    host: '0.0.0.0',
    strictPort: true,
    // Polling, because the machine's inotify watchers are used up by other dev servers (ENOSPC otherwise); the
    // reference folders hold tens of thousands of files, so they are never watched. Only this checkout's own .claude
    // folder is ignored (a lane worktree lives under the main checkout's .claude/worktrees and must watch itself).
    // Lane worktrees symlink node_modules from the main checkout: let the dev server serve files from there too
    // (fonts referenced by CSS are fetched through /@fs/ at their real path).
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), fs.realpathSync('node_modules')] },
    watch: { usePolling: true, interval: 500, ignored: [`${process.cwd()}/.claude/**`, '**/research/**', '**/re/**', '**/test-results/**', '**/spec/**'] },
  },
  preview: { port: 5197, host: '0.0.0.0', strictPort: true },
  // Relative base so the build works from the gh-pages sub-path.
  base: './',
  // Car and track-piece GLBs exist only after `npm run assets` (ssg model apply); restart the dev server after building them.
  define: { __HAS_MODELS__: JSON.stringify(fs.existsSync('public/models/models.json')) },
  build: {
    target: 'es2022',
    // three.js is most of the code: its own chunk, cached across game updates. The editor, the sound bench and the
    // dev-only scenes are dynamic imports (main.ts), so they load only when opened.
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: (id) => (/node_modules\/three\//.test(id) ? 'three' : undefined) } },
  },
});
