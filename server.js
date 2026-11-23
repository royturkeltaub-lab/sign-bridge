// Minimal static server for the Sign Bridge app (no build step).
// Serves /public as the web root, plus /src, /evals and a whitelisted part of /node_modules.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

// URL prefix -> directory on disk. Order matters: first match wins.
const MOUNTS = [
  ['/src/', path.join(ROOT, 'src')],
  ['/evals/', path.join(ROOT, 'evals')],
  ['/vendor/mediapipe/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')],
  ['/vendor/transformers/', path.join(ROOT, 'node_modules/@huggingface/transformers/dist')],
  ['/vendor/ort/', path.join(ROOT, 'node_modules/onnxruntime-web/dist')],
  ['/', path.join(ROOT, 'public')],
];

/** Map a request path to a file inside one of the mounts, refusing path traversal. */
export function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  for (const [prefix, dir] of MOUNTS) {
    if (!decoded.startsWith(prefix)) continue;
    const rel = decoded.slice(prefix.length) || 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) return null;
    return file;
  }
  return null;
}

const SECURITY_HEADERS = {
  // Needed for multi-threaded WASM (onnxruntime) and harmless otherwise.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * The one request handler, shared by `npm start` (http on localhost) and
 * `npm run share` (https on the LAN, or http behind a tunnel). GET/HEAD only,
 * files only (no directory listings), paths confined to the mounts above.
 */
export async function handleRequest(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' }).end('Method not allowed');
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/evals/index.json') {
      // List of eval case files, so new files are picked up without editing an index.
      const files = (await readdir(path.join(ROOT, 'evals/cases'))).filter((f) => f.endsWith('.json')).sort();
      const body = JSON.stringify(files);
      res.writeHead(200, {
        'Content-Type': MIME['.json'],
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
        ...SECURITY_HEADERS,
      });
      return void res.end(req.method === 'HEAD' ? undefined : body);
    }
    let file = resolvePath(url.pathname);
    if (!file) throw new Error('bad path');
    let info = await stat(file);
    if (info.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file);
    }
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': file.includes('node_modules') || file.includes(`${path.sep}models${path.sep}`)
        ? 'public, max-age=86400'
        : 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    if (res.headersSent) return void res.destroy();
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Not found');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  http.createServer(handleRequest).listen(PORT, HOST, () => {
    console.log(`Sign Bridge running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
    if (HOST === '127.0.0.1') console.log('For phones: npm run share  (HTTPS link + QR code)');
  });
}
