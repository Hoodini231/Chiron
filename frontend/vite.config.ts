import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pipelines': new URL('../dist', import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/results': 'http://127.0.0.1:8765',
    },
    fs: {
      allow: ['.', '..'],
    },
  },
});
