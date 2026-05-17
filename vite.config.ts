import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const SERVER_PORT = Number(process.env.LADDER_DEV_SERVER_PORT ?? 4317);

export default defineConfig({
  root: fileURLToPath(new URL('./src/web/client', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/web/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api':    { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: false },
      '/events': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: false },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
