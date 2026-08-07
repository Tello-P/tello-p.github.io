/* Builds web/dist/ — a fully static site for GitHub Pages.
 *
 *   node web/build-static.mjs
 *
 * Needs emscripten on PATH (`source /path/to/emsdk/emsdk_env.sh`). Output is
 * self-contained: index.html, the front-end modules, qcore.wasm compiled from
 * src/, and sources.json holding the C the code panel displays.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
const DIST = path.join(HERE, 'dist');

const CORE_SOURCES = ['src/fixed_point.c', 'src/quantum_core.c', 'src/quantum_register.c'];
const ENGINE_SOURCE = 'web/engine/qtrace.c';

/* The C shown in the code panel. Must include quantum_core.c — the debugger
 * highlights __LINE__ values from that file. */
const SOURCE_FILES = [
  'src/quantum_core.c',
  'src/quantum_register.c',
  'src/fixed_point.c',
  'includes/quantum_core.h',
  'includes/quantum_register.h',
  'includes/fixed_point.h',
  'includes/qtrace.h',
  'QuantumCore/src/fixed_point.cpp',
  'QuantumCore/src/quantum_core.cpp',
];

const EMCC_ARGS = [
  '-O2', '-Iincludes', '-DQTRACE',
  '-o', 'web/dist/qcore.js',
  ENGINE_SOURCE, ...CORE_SOURCES,
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sENVIRONMENT=web,worker,node',
  '-sEXPORTED_FUNCTIONS=_qt_run,_malloc,_free',
  '-sEXPORTED_RUNTIME_METHODS=ccall',
  '-sINVOKE_RUN=0',
  '-sEXIT_RUNTIME=0',
  '-sALLOW_MEMORY_GROWTH=1',
];

async function main() {
  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  // 1. front-end assets
  const assets = (await fsp.readdir(PUBLIC)).filter((f) => !f.startsWith('.'));
  for (const name of assets) {
    await fsp.copyFile(path.join(PUBLIC, name), path.join(DIST, name));
  }
  console.log(`copied ${assets.length} front-end files: ${assets.join(', ')}`);

  // 2. the C core -> WebAssembly
  try {
    await execFileAsync('emcc', EMCC_ARGS, { cwd: ROOT });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('\nemcc not found. Install and activate the Emscripten SDK:\n' +
        '  git clone https://github.com/emscripten-core/emsdk\n' +
        '  cd emsdk && ./emsdk install latest && ./emsdk activate latest\n' +
        '  source ./emsdk_env.sh\n');
      process.exit(1);
    }
    console.error(err.stderr || err.message);
    process.exit(1);
  }
  const wasmBytes = (await fsp.stat(path.join(DIST, 'qcore.wasm'))).size;
  console.log(`compiled qcore.wasm (${(wasmBytes / 1024).toFixed(1)} kB) from ${CORE_SOURCES.length} core sources`);

  // 3. sources for the code panel (no /api/sources without a server)
  const files = [];
  for (const rel of SOURCE_FILES) {
    try {
      files.push({ path: rel, text: await fsp.readFile(path.join(ROOT, rel), 'utf8') });
    } catch { /* optional file */ }
  }
  await fsp.writeFile(path.join(DIST, 'sources.json'), JSON.stringify({ files }));
  console.log(`bundled ${files.length} source files for the code panel`);

  // 4. Pages must not run these through Jekyll
  await fsp.writeFile(path.join(DIST, '.nojekyll'), '');

  console.log(`\ndist ready at ${DIST}`);
  console.log('preview with:  npx serve web/dist   (or any static file server)');
}

main();
