import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['three'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@erasofempire/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/pixi.js/')) {
              return 'pixi-vendor';
            }
            if (id.includes('/firebase/') || id.includes('@capacitor/')) {
              return 'mobile-push-vendor';
            }
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) {
              return 'react-vendor';
            }
            if (id.includes('react-globe.gl') || id.includes('/globe.gl/') || id.includes('/kapsule/')) {
              return 'globe-runtime';
            }
            if (id.includes('/three/')) {
              return 'three-vendor';
            }
            if (id.includes('three-conic-polygon-geometry') || id.includes('/d3-') || id.includes('/topojson-')) {
              return 'geo-vendor';
            }
          }
          return undefined;
        },
      },
    },
  },
});
