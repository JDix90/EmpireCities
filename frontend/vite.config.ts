import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Map Hub lives at /maps but regional JSON ships under public/maps/ — avoid 403 on /maps/. */
function mapHubSpaFallback(): Plugin {
  return {
    name: 'map-hub-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (pathname === '/maps' || pathname === '/maps/') {
          req.url = '/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mapHubSpaFallback()],
  resolve: {
    dedupe: ['three'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@borderfall/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
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
