import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // Proxy API requests to the backend during dev (no effect on `vite build`).
        // Defaults to local backend; set DEV_PROXY_TARGET in .env.local to override
        // (e.g. https://simple-docs-9u3r.onrender.com for the deployed backend).
        '/api': {
          target: env.DEV_PROXY_TARGET || 'http://localhost:3000',
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
