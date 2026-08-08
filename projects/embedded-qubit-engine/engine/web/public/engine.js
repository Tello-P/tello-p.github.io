/* Two ways to run the same C core, behind one interface.
 *
 *   gcc   — a local Node server compiles src/ on demand and streams the trace.
 *           Edits to the C are picked up on the next run, so this is the one to
 *           use while actually working on the engine.
 *   wasm  — the same sources precompiled to WebAssembly, running in the tab.
 *           No server, no toolchain: this is what GitHub Pages serves.
 *
 * Both call the identical qt_run() in web/engine/qtrace.c and emit identical
 * events — verified byte-for-byte by web/tools/check-parity.mjs.
 */

import { serialiseProgram } from './program.js';

/* ---- gcc (local server) ------------------------------------------------- */

const serverEngine = {
  kind: 'gcc',
  label: 'gcc · local server',

  async sources() {
    const res = await fetch('./api/sources');
    return (await res.json()).files;
  },

  async run(body, onEvent) {
    const res = await fetch('./api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`server returned ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (raw) emit(raw, onEvent);
      }
    }
  },
};

/* ---- wasm (in-tab) ------------------------------------------------------ */

let modulePromise = null;
let sink = null;

const wasmEngine = {
  kind: 'wasm',
  label: 'bundled · in-browser',

  async sources() {
    const res = await fetch('./sources.json');
    return (await res.json()).files;
  },

  async run(body, onEvent) {
    const mod = await this.module();
    const program = serialiseProgram(body);

    onEvent({ ev: 'build_ok', command: 'qcore.wasm (prebuilt from src/)', stderr: '', ms: 0, program });

    // qt_run is synchronous; sink routes each printed line straight through
    sink = (line) => { const t = line.trim(); if (t) emit(t, onEvent); };
    try {
      mod.ccall('qt_run', 'number', ['string'], [program]);
    } finally {
      sink = null;
    }
  },

  module() {
    if (!modulePromise) {
      modulePromise = import('./qcore.js').then(({ default: init }) => init({
        print: (line) => { if (sink) sink(line); },
        printErr: (line) => console.warn('[qcore]', line),
      }));
    }
    return modulePromise;
  },
};

function emit(raw, onEvent) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return; }
  onEvent(parsed);
}

/* ---- selection ---------------------------------------------------------- */

/* Prefer the gcc server when one is actually listening — it recompiles the C
 * on every run, which is the point of having it. Otherwise use the bundle. */
async function detect() {
  const forced = new URLSearchParams(location.search).get('engine');
  if (forced === 'wasm') return wasmEngine;
  if (forced === 'gcc') return serverEngine;

  try {
    const res = await fetch('./api/health', { cache: 'no-store' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      return serverEngine;
    }
  } catch { /* no server here — that is the normal case on GitHub Pages */ }

  return wasmEngine;
}

export const engine = {
  active: null,
  async init() {
    this.active = await detect();
    return this.active;
  },
  run(body, onEvent) { return this.active.run(body, onEvent); },
  sources() { return this.active.sources(); },
  get kind() { return this.active?.kind; },
  get label() { return this.active?.label ?? 'detecting…'; },
};
