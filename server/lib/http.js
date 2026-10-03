'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8', '.woff2': 'font/woff2' };

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), fullscreen=(self)');
  // 供应商 iframe 需要 frame-src 放行其域名：生产请把 https: 收窄为供应商域名白名单。
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: " + (process.env.CSP_IMG_SRC_EXTRA || 'https:') + "; connect-src 'self'; frame-src 'self' https:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = config.env.allowedOrigins;
  if (allowed.includes('*') || allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Region');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
function json(res, status, body, headers) {
  const s = JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s) }, headers));
  res.end(s);
}
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('请求体过大'), { http: 413, code: 'PAYLOAD_TOO_LARGE' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const gz = new Map();
function serveStatic(req, res, urlPath) {
  const root = path.resolve(config.env.publicDir);
  let p;
  try { p = decodeURIComponent(urlPath); } catch { res.writeHead(400); return res.end(); }
  if (p.includes('\0')) { res.writeHead(400); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(root, '.' + path.sep + p.replace(/^\/+/, ''));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const h = { 'Content-Type': type, ETag: etag, 'Cache-Control': ext === '.html' ? 'no-cache' : /^\/assets\/(covers|logos)\//.test(urlPath) ? 'public, max-age=86400' : 'public, max-age=300, must-revalidate', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    const compress = /\b(html|css|javascript|json|svg|yaml)\b/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (!compress) { h['Content-Length'] = st.size; res.writeHead(200, h); return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res); }
    const k = file + etag;
    const send = (buf) => { h['Content-Encoding'] = 'gzip'; h['Content-Length'] = buf.length; res.writeHead(200, h); res.end(req.method === 'HEAD' ? undefined : buf); };
    if (gz.has(k)) return send(gz.get(k));
    fs.readFile(file, (e, data) => { if (e) { res.writeHead(500); return res.end(); } const z = zlib.gzipSync(data); gz.set(k, z); send(z); });
  });
}

// 极简内存限流(按 IP + 桶名)。生产请在网关/WAF 做。
const buckets = new Map();
function rateLimit(ip, name, max, windowMs) {
  const k = name + ':' + ip, now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();

module.exports = { json, readBody, serveStatic, securityHeaders, cors, rateLimit };
