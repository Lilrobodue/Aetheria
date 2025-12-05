import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // Set base path - root for custom domain
      base: '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.PUBLIC_URL': JSON.stringify('/')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        // Copy service worker to dist
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            sw: path.resolve(__dirname, 'public/sw.js')
          },
          output: {
            entryFileNames: (chunkInfo) => {
              if (chunkInfo.name === 'sw') {
                return 'sw.js'; // Place service worker at root
              }
              return 'assets/[name]-[hash].js';
            }
          }
        }
      },
      publicDir: 'public'
    };
});
