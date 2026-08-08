/* Proves the WebAssembly build and the native gcc build of the core produce
 * byte-identical traces.
 *
 *   node engine/web/tools/check-parity.mjs
 *
 * Expects web/build/qtrace (native) and ../demo/qcore.js (wasm) to exist —
 * `make web-dist` builds both. Exits non-zero on any divergence.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NATIVE = path.join(ROOT, 'web/build/qtrace');
const WASM = path.resolve(ROOT, '../demo/qcore.js');

const PROGRAMS = [
  ['bell + measure',      'qubits 2\nmode step\nop h 0\nop cnot 0 1\nop measure 0\nrun\n'],
  ['grover 2q seeded',    'qubits 2\nmode step\nseed 424242\nop h 0\nop h 1\nop oracle 3\nop diffuser\nop measure 0\nop measure 1\nrun\n'],
  ['ghz 3q gate-mode',    'qubits 3\nmode gate\nseed 7\nop h 0\nop cnot 0 1\nop cnot 0 2\nop measure 1\nrun\n'],
  ['interference 1q',     'qubits 1\nmode step\nop h 0\nop z 0\nop h 0\nrun\n'],
  ['grover 4q',           'qubits 4\nmode gate\nseed 99\nop h 0\nop h 1\nop h 2\nop h 3\nop oracle 9\nop diffuser\nrun\n'],
  ['teleport skeleton',   'qubits 3\nmode step\nseed 5\nop x 0\nop h 1\nop cnot 1 2\nop cnot 0 1\nop h 0\nop measure 0\nop measure 1\nrun\n'],
  ['oversized register',  'qubits 6\nmode gate\nop h 0\nrun\n'],
];

// the two timings are wall-clock readings; everything else must match exactly
const strip = (s) => s
  .replace(/"compute_us":[0-9.-]+/g, '"compute_us":X')
  .replace(/"trace_us":[0-9.-]+/g, '"trace_us":X')
  .trim();

const { default: initModule } = await import(WASM);
let lines = [];
const mod = await initModule({ print: (l) => lines.push(l), printErr: () => {} });

let failures = 0;
for (const [name, program] of PROGRAMS) {
  lines = [];
  mod.ccall('qt_run', 'number', ['string'], [program]);
  const wasm = strip(lines.join('\n'));
  // a rejected program exits non-zero; its stdout is still the trace to compare
  let nativeOut;
  try {
    nativeOut = execFileSync(NATIVE, { input: program, encoding: 'utf8' });
  } catch (err) {
    nativeOut = err.stdout ?? '';
  }
  const native = strip(nativeOut);

  if (wasm === native) {
    console.log(`  ok    ${name.padEnd(22)} ${wasm.split('\n').length} events`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
    const a = native.split('\n'), b = wasm.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`        native: ${a[i]}`);
        console.log(`        wasm  : ${b[i]}`);
        break;
      }
    }
  }
}

console.log(failures
  ? `\n${failures}/${PROGRAMS.length} programs diverged`
  : `\nall ${PROGRAMS.length} programs byte-identical across gcc and wasm`);
process.exit(failures ? 1 : 0);
