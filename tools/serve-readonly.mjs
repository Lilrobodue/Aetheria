// tools/serve-readonly.mjs — a tiny read-only static server for the dev parity page (build spec v15.1 §11.3) and
// the release scripts: it serves reference audio and its library.json to a page on the test origin, on this PC or
// on the phone through `adb reverse`. Dev-only; never deployed.
//
//   node tools/serve-readonly.mjs --port 3210 --origin http://localhost:3299 lib=<dir> wav=<dir> mp3=<dir> sub=<dir>
//
// Each name=dir argument mounts a folder at /<name>/. It binds 127.0.0.1 only, answers GET and HEAD only, serves
// files only (no listings), resolves every path inside its mount (no `..`, no symlink escape), sets Content-Type by
// extension and `Access-Control-Allow-Origin: <origin>`. It logs counts, never file names. Stop it with Ctrl+C.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  let port = 3210;
  let origin = 'http://localhost:3299';
  const mounts = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') port = Number(argv[++i]);
    else if (a === '--origin') origin = String(argv[++i]);
    else if (/^[a-z0-9][a-z0-9-]*=/i.test(a)) {
      const at = a.indexOf('=');
      const name = a.slice(0, at), dir = a.slice(at + 1);
      const real = fs.realpathSync(dir);
      if (!fs.statSync(real).isDirectory()) throw new Error(`mount ${name} is not a folder`);
      mounts.set(name, real);
    } else throw new Error(`unexpected argument (expected --port, --origin or name=dir): #${i + 1}`);
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('bad --port');
  if (!mounts.size) throw new Error('give at least one name=dir mount');
  return { port, origin, mounts };
}

const { port, origin, mounts } = parseArgs(process.argv.slice(2));
const counts = { served: 0, head: 0, notFound: 0, refused: 0, errors: 0 };
let lastLog = 0;
function logCounts(force = false) {
  const total = counts.served + counts.head + counts.notFound + counts.refused + counts.errors;
  if (!force && total - lastLog < 20) return;
  lastLog = total;
  console.log(`[serve-readonly] served ${counts.served}, head ${counts.head}, not found ${counts.notFound}, refused ${counts.refused}, errors ${counts.errors}`);
}

/** The file a request names, or null: inside its mount even after resolving symlinks, and a regular file. */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return null;
  const parts = decoded.split('/').filter((p) => p !== '');
  if (parts.length < 2) return null;
  const root = mounts.get(parts[0]);
  if (!root) return null;
  if (parts.slice(1).some((p) => p === '.' || p === '..')) return null;
  const target = path.resolve(root, ...parts.slice(1));
  const inside = (p) => p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  if (!inside(target)) return null;
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return null;
  }
  if (!inside(real)) return null;
  try {
    if (!fs.statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    counts.refused++;
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    logCounts();
    return;
  }
  const urlPath = (req.url || '/').split('?')[0];
  const file = resolveFile(urlPath);
  if (!file) {
    counts.notFound++;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    logCounts();
    return;
  }
  const size = fs.statSync(file).size;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': size });
  if (req.method === 'HEAD') {
    counts.head++;
    res.end();
    logCounts();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    counts.errors++;
    res.destroy();
  });
  stream.on('end', () => {
    counts.served++;
    logCounts();
  });
  stream.pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[serve-readonly] listening on http://127.0.0.1:${port} with ${mounts.size} mount(s): ${[...mounts.keys()].join(', ')}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logCounts(true);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
