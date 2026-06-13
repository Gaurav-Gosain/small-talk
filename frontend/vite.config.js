import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the FastAPI backend so the browser sees one origin.
      '/api': 'http://localhost:8000',
    },
  },
});
