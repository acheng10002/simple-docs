import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (empty prefix) so we can read non-VITE_ config-only vars.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // Proxy API requests to the backend during dev (no effect on `vite build`).
        // Default targets the deployed backend; set DEV_PROXY_TARGET in .env.local
        // (e.g. http://localhost:3000) to point at a locally running backend.
        '/api': {
          target: env.DEV_PROXY_TARGET || 'https://simple-docs-9u3r.onrender.com',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
    },
  };
});
