import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: { preserveSymlinks: true },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:4100', changeOrigin: true } },
    },
    test: { environment: 'jsdom', exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'], passWithNoTests: true },
  };
});


