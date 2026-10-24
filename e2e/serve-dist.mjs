// A static server for a production build (vite build --outDir <dist>), with GitHub-Pages-like headers:
// Cache-Control: max-age=600, Vary: Accept-Encoding, Access-Control-Allow-Origin: *, and the right content types.
// Used by the parity suite (tests/parity.spec.ts, run with E2E_REUSE_SERVER=1) and the offline check
// (offline-check.mjs). Never `vite preview` for those: it sends Vary: Origin with Cache-Control: no-cache, and
// under that pair the service worker's offline reload stalls at "Initializing Aetheria..." (v15.2.1 and v15.3
// alike), which production never does.
//
//   node e2e/serve-dist.mjs --dir <dist> [--port 3199]
//
// node: built-ins only. It refuses port 3100 (the dev server you run yourself) and serves nothing outside <dir>.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

/**
 * Serve `dir` on localhost:`port`. Resolves once listening, with { port, close() }; close() drops open
 * connections and stops the server.
 */
export function serve(dir, { port = 3199 } = {}) {
  if (Number(port) === 3100) throw new Error('serve-dist: port 3100 is your own dev server; pick another port');
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`serve-dist: no index.html in ${root}`);
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('bad request');
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(root, pathname);
    const inside = file === root || file.startsWith(root + path.sep);
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=600' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': 'max-age=600',
      Vary: 'Accept-Encoding',
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), 'localhost', () =>
      resolve({
        port: Number(port),
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      })
    );
  });
}

// CLI: node e2e/serve-dist.mjs --dir <dist> [--port 3199]
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const dir = arg('dir');
  const port = Number(arg('port', '3199'));
  if (!dir) {
    console.error('usage: node e2e/serve-dist.mjs --dir <dist> [--port 3199]');
    process.exit(2);
  }
  const server = await serve(dir, { port });
  console.log(`serve-dist: ${path.resolve(dir)} on http://localhost:${server.port} (Pages-like headers)`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
