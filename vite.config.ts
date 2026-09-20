import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // Same-origin in dev so the client can use relative /api paths and there
    // is no CORS to think about in the browser.
    // changeOrigin stays FALSE: the API refuses a state-changing request whose Origin
    // names a different host than the one it was sent to (CSRF — server/auth.ts).
    // Rewriting Host to :8787 while the browser's Origin says :5173 would trip that.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false, xfwd: true } },
  },
});
