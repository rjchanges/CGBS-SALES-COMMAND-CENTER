import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { preserveSymlinks: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4100', changeOrigin: true } },
  },
  test: { environment: 'jsdom', exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'], passWithNoTests: true },
});


