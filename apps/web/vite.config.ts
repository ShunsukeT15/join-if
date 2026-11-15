import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Adds a strict CSP to the built index.html (not in dev, where HMR needs inline scripts). */
function csp(apiBase: string): Plugin {
  const apiOrigin = apiBase ? new URL(apiBase).origin : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ' ' + apiOrigin : ''}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'himitsu-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), csp(env.VITE_API_BASE_URL ?? '')],
    server: {
      port: 5173,
      proxy: { '/api': { target: env.VITE_DEV_API_PROXY ?? 'http://localhost:8787', changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
