/* Embedded Qubit Engine - web debugger backend.
 *
 * Zero dependencies. Compiles the real C core with -DQTRACE via gcc, runs it,
 * and streams the resulting NDJSON trace to the browser.
 *
 *   node web/server.mjs [--port 5173]
 */

import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serialiseProgram } from './public/program.js';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
const BUILD = path.join(HERE, 'build');
const DIST = path.join(HERE, 'dist');
const BIN = path.join(BUILD, 'qtrace');

const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) : 5173;

const CORE_SOURCES = ['src/fixed_point.c', 'src/quantum_core.c', 'src/quantum_register.c'];
const ENGINE_SOURCE = 'web/engine/qtrace.c';

/* ---- build ------------------------------------------------------------- */

async function needsRebuild() {
  let binTime;
  try {
    binTime = (await fsp.stat(BIN)).mtimeMs;
  } catch {
    return true;
  }
  const deps = [...CORE_SOURCES, ENGINE_SOURCE, 'includes/quantum_core.h',
                'includes/quantum_register.h', 'includes/fixed_point.h', 'includes/qtrace.h'];
  for (const dep of deps) {
    try {
      if ((await fsp.stat(path.join(ROOT, dep))).mtimeMs > binTime) return true;
    } catch { /* missing dep -> let gcc report it */ }
  }
  return false;
}

async function buildEngine() {
  await fsp.mkdir(BUILD, { recursive: true });
  const args = [
    '-Wall', '-Wextra', '-O2',
    '-Iincludes', '-DQTRACE',
    '-o', path.relative(ROOT, BIN),
    ENGINE_SOURCE, ...CORE_SOURCES,
  ];
  const started = Date.now();
  const { stderr } = await execFileAsync('gcc', args, { cwd: ROOT });
  return { command: `gcc ${args.join(' ')}`, stderr, ms: Date.now() - started };
}

/* Re-checked on every run: `make clean` or an edit outside the editor must be
 * picked up, so only the in-flight compile is shared, never its verdict. */
let inFlight = null;
let lastBuild = { command: 'up to date', stderr: '', ms: 0 };

function ensureBuilt() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (await needsRebuild()) lastBuild = await buildEngine();
    return lastBuild;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/* ---- HTTP helpers ------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req, limit = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* ---- source files exposed to the code panel ----------------------------- */

const SOURCE_FILES = [
  'src/quantum_core.c',
  'src/quantum_register.c',
  'src/fixed_point.c',
  'includes/quantum_core.h',
  'includes/quantum_register.h',
  'includes/fixed_point.h',
  'QuantumCore/src/fixed_point.cpp',
  'QuantumCore/src/quantum_core.cpp',
];

/* ---- routes -------------------------------------------------------------- */

async function handleRun(req, res) {
  let program;
  try {
    const body = JSON.parse(await readBody(req));
    program = serialiseProgram(body);
  } catch (err) {
    return sendJson(res, 400, { error: String(err.message ?? err) });
  }

  let build;
  try {
    build = await ensureBuilt();
  } catch (err) {
    const detail = err.stderr || err.message || String(err);
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    res.end(JSON.stringify({ ev: 'build_error', detail }) + '\n');
    return;
  }

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  res.write(JSON.stringify({ ev: 'build_ok', ...build, program }) + '\n');

  const child = spawn(BIN, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 20_000);

  child.stdin.end(program);
  child.stdout.pipe(res, { end: false });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  child.on('close', (code, signal) => {
    clearTimeout(killTimer);
    if (code !== 0 || stderr) {
      res.write(JSON.stringify({ ev: 'exit', code, signal, stderr }) + '\n');
    }
    res.end();
  });

  child.on('error', (err) => {
    clearTimeout(killTimer);
    res.end(JSON.stringify({ ev: 'exit', code: -1, stderr: String(err) }) + '\n');
  });

  req.on('close', () => { if (!child.killed) child.kill('SIGKILL'); });
}

async function handleSources(_req, res) {
  const out = [];
  for (const rel of SOURCE_FILES) {
    try {
      out.push({ path: rel, text: await fsp.readFile(path.join(ROOT, rel), 'utf8') });
    } catch { /* optional file */ }
  }
  sendJson(res, 200, { files: out });
}

async function handleStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);

  /* Serve from public/, falling back to dist/ so the ?engine=wasm override can
   * find qcore.wasm & sources.json locally once `make web-dist` has run. */
  for (const base of [PUBLIC, DIST]) {
    const file = path.resolve(base, rel);
    if (file !== base && !file.startsWith(base + path.sep)) continue;  // no traversal
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      return res.end(data);
    } catch { /* try the next base */ }
  }
  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // The browser probes this to decide between the gcc engine and the bundled
  // WebAssembly one; on GitHub Pages it 404s and the page falls back to wasm.
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { engine: 'gcc', root: ROOT });
  }
  if (req.method === 'POST' && url.pathname === '/api/run') return handleRun(req, res);
  if (req.method === 'GET' && url.pathname === '/api/sources') return handleSources(req, res);
  if (req.method === 'GET') return handleStatic(req, res, url);
  sendJson(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Embedded Qubit Engine debugger -> http://127.0.0.1:${PORT}`);
  console.log(`serving core from ${ROOT}`);
});
