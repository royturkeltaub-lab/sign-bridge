// `npm run share` - open Sign Bridge on a phone.
//
// Phones only allow the camera and microphone on secure (https) pages, so a plain
// http://<LAN-IP>:5173 link does not work. Two modes:
//
//   npm run share               LAN mode (default). HTTPS on this Mac with a self-signed
//                               certificate. Nothing leaves the local network.
//   npm run share -- --public   Public mode. A Cloudflare quick tunnel gives a public https
//                               link that works from any network (needs `cloudflared`).
//
// Options: --port <n> (default 5443 in LAN mode, 5174 in public mode; or env SHARE_PORT).
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../server.js';
import { qrToTerminal } from './qr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT_DIR = path.join(ROOT, '.cert');
const args = process.argv.slice(2);
const PUBLIC = args.includes('--public');

function portArg(fallback) {
  const i = args.indexOf('--port');
  const raw = i >= 0 ? args[i + 1] : process.env.SHARE_PORT;
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${raw}`);
    process.exit(1);
  }
  return port;
}

/** IPv4 addresses of this machine, home/office Wi-Fi ranges first (VPN-style addresses last). */
export function lanAddresses() {
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) found.push(a.address);
    }
  }
  return [...new Set(found)].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

/** True if the stored certificate is still valid for a while and covers every address. */
function certCovers(certPem, ips) {
  try {
    const cert = new X509Certificate(certPem);
    if (Date.parse(cert.validTo) - Date.now() < 24 * 3600 * 1000) return false;
    const san = cert.subjectAltName || '';
    return ips.every((ip) => san.includes(`IP Address:${ip}`));
  } catch {
    return false;
  }
}

/** Load the self-signed certificate from .cert/, (re)creating it with openssl when needed. */
function ensureCertificate(ips) {
  const keyFile = path.join(CERT_DIR, 'key.pem');
  const certFile = path.join(CERT_DIR, 'cert.pem');
  if (existsSync(keyFile) && existsSync(certFile) && certCovers(readFileSync(certFile), ips)) {
    return { key: readFileSync(keyFile), cert: readFileSync(certFile), created: false };
  }
  mkdirSync(CERT_DIR, { recursive: true, mode: 0o700 });
  // Keep the private key out of any future git repo.
  writeFileSync(path.join(CERT_DIR, '.gitignore'), '*\n');
  const sans = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)];
  const confFile = path.join(CERT_DIR, 'openssl.cnf');
  writeFileSync(confFile, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = ext', 'prompt = no',
    '[dn]', 'CN = Sign Bridge (local)',
    '[ext]', `subjectAltName = ${sans.join(', ')}`,
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth', '',
  ].join('\n'));
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
    '-keyout', keyFile, '-out', certFile, '-config', confFile,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.error('Could not create a certificate with `openssl`:');
    console.error(result.error ? result.error.message : result.stderr);
    process.exit(1);
  }
  chmodSync(keyFile, 0o600);
  return { key: readFileSync(keyFile), cert: readFileSync(certFile), created: true };
}

function listen(server, port, host) {
  return new Promise((resolve) => {
    server.once('error', (err) => {
      console.error(err.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Pick another one: npm run share -- --port ${port + 1}`
        : `Could not start the server: ${err.message}`);
      process.exit(1);
    });
    server.listen(port, host, resolve);
  });
}

function printLink(url) {
  const qr = qrToTerminal(url);
  console.log(`\n  ${url}\n`);
  if (qr) console.log(`${qr}\n`);
}

function stopOnSignal(stop) {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      stop();
      process.exit(0);
    });
  }
}

async function shareOnLan() {
  const ips = lanAddresses();
  if (!ips.length) {
    console.error('No network connection found. Join a Wi-Fi network first, or use: npm run share -- --public');
    process.exit(1);
  }
  const port = portArg(5443);
  const { key, cert, created } = ensureCertificate(ips);
  const server = https.createServer({ key, cert }, handleRequest);
  await listen(server, port, '0.0.0.0');
  stopOnSignal(() => server.close());

  console.log('Sign Bridge - phone link (local network only)');
  if (created) console.log(`Created a self-signed certificate in ${path.relative(ROOT, CERT_DIR)}/`);
  printLink(`https://${ips[0]}:${port}`);
  for (const ip of ips.slice(1)) console.log(`  also reachable at https://${ip}:${port}`);
  console.log([
    'How to open it:',
    '  1. The phone must be on the same Wi-Fi as this Mac (guest/office Wi-Fi may block this).',
    '  2. Scan the QR code or type the link. The phone shows a certificate warning once:',
    '     iPhone: "Show Details" > "visit this website".  Android: "Advanced" > "Proceed".',
    '  3. Allow camera and microphone when asked.',
    '  If macOS asks whether to allow incoming connections for "node", choose Allow.',
    'Anyone on this Wi-Fi can open the link while this is running. Press Ctrl+C to stop.',
    'For a link that works from any network: npm run share -- --public',
  ].join('\n'));
}

async function sharePublicly() {
  const probe = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.log('Public mode needs cloudflared. Install it with:  brew install cloudflared');
    console.log('Then run again:  npm run share -- --public   (or use LAN mode: npm run share)');
    return;
  }
  const port = portArg(5174);
  const server = http.createServer(handleRequest);
  await listen(server, port, '127.0.0.1'); // only the tunnel talks to it

  console.log('Sign Bridge - starting a public link (Cloudflare quick tunnel)...');
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let announced = false;
  let log = '';
  const onOutput = (chunk) => {
    log = (log + chunk).slice(-4000);
    const match = !announced && log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!match) return;
    announced = true;
    printLink(match[0]);
    console.log([
      'Send this link to anyone - it works from any network, no certificate warning.',
      'It can take a few seconds before the link starts responding.',
      'Anyone who has the link can open the app while this is running. Press Ctrl+C to stop sharing.',
    ].join('\n'));
  };
  tunnel.stdout.on('data', onOutput);
  tunnel.stderr.on('data', onOutput);
  tunnel.on('exit', (code) => {
    if (!announced) console.error(`cloudflared stopped before giving a link (exit ${code}).\n${log}`);
    else console.log('Tunnel closed.');
    server.close();
    process.exit(announced ? 0 : 1);
  });
  stopOnSignal(() => {
    tunnel.kill('SIGTERM');
    server.close();
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await (PUBLIC ? sharePublicly() : shareOnLan());
}
