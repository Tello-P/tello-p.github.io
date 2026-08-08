/* Circuit -> qtrace program text.
 *
 * Shared by both engines: web/server.mjs imports this for the gcc path and the
 * browser imports it for the WebAssembly path, so a circuit serialises to the
 * exact same directives either way.
 */

export const OP_ARITY = {
  h: 1, x: 1, z: 1, cnot: 2, oracle: 1, measure: 1, diffuser: 0,
};

export function clampInt(value, lo, hi, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function serialiseProgram(body) {
  const qubits = clampInt(body.qubits, 1, 6, 2);
  const mode = body.mode === 'gate' ? 'gate' : 'step';
  const lines = [`qubits ${qubits}`, `mode ${mode}`];

  if (body.seed !== undefined && body.seed !== null && body.seed !== '') {
    const seed = BigInt(body.seed) & ((1n << 64n) - 1n);
    lines.push(`seed ${seed}`);
  }

  for (const op of body.ops ?? []) {
    const name = String(op.name ?? '').toLowerCase();
    if (!(name in OP_ARITY)) throw new Error(`unknown op: ${name}`);
    const arity = OP_ARITY[name];
    const a = arity >= 1 ? clampInt(op.a, 0, 63, 0) : -1;
    const b = arity >= 2 ? clampInt(op.b, 0, 63, 0) : -1;
    lines.push(`op ${name} ${a} ${b}`);
  }

  lines.push('run');
  return lines.join('\n') + '\n';
}
