/* Embedded Qubit Engine — trace debugger front-end.
 *
 * Every number rendered here comes out of the real C core: the browser never
 * simulates a gate. It consumes NDJSON trace events from one of two engines
 * (see engine.js) and plays them back.
 */

import { engine } from './engine.js';

const Q14 = 16384;

const $ = (id) => document.getElementById(id);

const el = {
  qubits: $('qubits'), mode: $('mode'), seed: $('seed'), run: $('run'), theme: $('theme'),
  preset: $('preset'), clear: $('clear'), palette: $('palette'),
  argA: $('arg-a'), argB: $('arg-b'), wrapB: $('wrap-b'), lblA: $('lbl-a'),
  circuit: $('circuit'), circuitHint: $('circuit-hint'),
  amps: $('amps'), statrow: $('statrow'), bloch: $('bloch'),
  srcfile: $('srcfile'), code: $('code'),
  scrub: $('scrub'), counter: $('counter'), status: $('status'), speed: $('speed'),
  engineBadge: $('engine-badge'),
  tpFirst: $('tp-first'), tpPrev: $('tp-prev'), tpPlay: $('tp-play'),
  tpNext: $('tp-next'), tpLast: $('tp-last'),
  help: $('help'), guide: $('guide'), guideClose: $('guide-close'),
};

/* ── model ─────────────────────────────────────────────────────── */

const OPS = {
  h:        { label: 'H',    args: ['target'],             span: false },
  x:        { label: 'X',    args: ['target'],             span: false },
  z:        { label: 'Z',    args: ['target'],             span: false },
  cnot:     { label: '⊕',    args: ['control', 'target'],  span: false },
  oracle:   { label: 'Ω',    args: ['basis state'],        span: true  },
  diffuser: { label: 'DIFF', args: [],                     span: true  },
  measure:  { label: 'M',    args: ['target'],             span: false },
};

const PRESETS = {
  bell:      { qubits: 2, ops: [['h', 0], ['cnot', 0, 1], ['measure', 0]] },
  ghz:       { qubits: 3, ops: [['h', 0], ['cnot', 0, 1], ['cnot', 0, 2]] },
  grover:    { qubits: 2, ops: [['h', 0], ['h', 1], ['oracle', 3], ['diffuser'], ['measure', 0], ['measure', 1]] },
  grover3:   { qubits: 3, ops: [['h', 0], ['h', 1], ['h', 2], ['oracle', 5], ['diffuser']] },
  teleport:  { qubits: 3, ops: [['x', 0], ['h', 1], ['cnot', 1, 2], ['cnot', 0, 1], ['h', 0], ['measure', 0], ['measure', 1]] },
  interfere: { qubits: 1, ops: [['h', 0], ['z', 0], ['h', 0]] },
};

const model = {
  qubits: 2,
  ops: [],            // [{ name, a, b }]
  frames: [],         // playback timeline
  cursor: 0,
  dim: 4,
  playing: false,
  timer: null,
  sources: new Map(),
  codeLines: [],      // DOM nodes of the rendered source
  lastHit: -1,
};

/* ── small helpers ─────────────────────────────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function ket(index, qubits) {
  let s = '';
  for (let b = qubits - 1; b >= 0; b--) s += (index >> b) & 1;
  return `|${s}⟩`;
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.dataset.kind = kind;
}

/* ── argument selectors ────────────────────────────────────────── */

let pendingOp = null;

function fillSelect(select, count, labeller) {
  const keep = select.value;
  select.replaceChildren();
  for (let i = 0; i < count; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = labeller(i);
    select.append(o);
  }
  if (keep !== '' && Number(keep) < count) select.value = keep;
}

function refreshArgs() {
  const n = model.qubits;
  const op = pendingOp ? OPS[pendingOp] : null;

  if (pendingOp === 'oracle') {
    fillSelect(el.argA, 1 << n, (i) => `${ket(i, n)}  (${i})`);
    el.lblA.textContent = 'Basis state';
  } else {
    fillSelect(el.argA, n, (i) => `q${i}`);
    el.lblA.textContent = op && op.args[0] === 'control' ? 'Control' : 'Target';
  }

  fillSelect(el.argB, n, (i) => `q${i}`);
  el.wrapB.hidden = !(op && op.args.length === 2);
  if (!el.wrapB.hidden && el.argB.value === el.argA.value) {
    el.argB.value = String((Number(el.argA.value) + 1) % n);
  }
}

/* ── circuit ───────────────────────────────────────────────────── */

function addOp(name) {
  const spec = OPS[name];
  const a = spec.args.length >= 1 ? Number(el.argA.value) : -1;
  const b = spec.args.length >= 2 ? Number(el.argB.value) : -1;

  if (name === 'cnot' && a === b) {
    setStatus('CNOT needs distinct control and target qubits.', 'error');
    return;
  }
  model.ops.push({ name, a, b });
  drawCircuit();
  setStatus(`Added ${name.toUpperCase()} — ${model.ops.length} op(s) queued. Press Compile & run.`);
}

function drawCircuit() {
  const n = model.qubits;
  const cols = Math.max(model.ops.length, 1);
  const rowH = 34, colW = 44, padL = 34, padR = 14, padT = 14, padB = 12;
  const width = padL + cols * colW + padR;
  const height = padT + n * rowH + padB;

  el.circuit.setAttribute('width', width);
  el.circuit.setAttribute('height', height);
  el.circuit.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.circuit.replaceChildren();

  const yOf = (q) => padT + q * rowH + rowH / 2;
  const xOf = (k) => padL + k * colW + colW / 2;

  // playhead column highlight (updated per frame)
  const playhead = svg('rect', {
    class: 'col-playhead', x: 0, y: padT - 4,
    width: colW, height: n * rowH + 8, rx: 5, opacity: 0,
  });
  el.circuit.append(playhead);
  el.circuit._playhead = playhead;
  el.circuit._xOf = xOf;
  el.circuit._colW = colW;

  for (let q = 0; q < n; q++) {
    el.circuit.append(
      svg('line', { class: 'wire', x1: padL - 8, y1: yOf(q), x2: width - padR + 4, y2: yOf(q) }),
      svg('text', { class: 'wire-label', x: 4, y: yOf(q) + 3.5 }, `q${q}`),
    );
  }

  if (!model.ops.length) {
    el.circuit.append(svg('text', { class: 'empty-note', x: padL + 6, y: padT + 12 },
      'empty circuit'));
    return;
  }

  model.ops.forEach((op, k) => {
    const spec = OPS[op.name];
    const g = svg('g', { class: 'gate-g', 'data-index': k });
    g.addEventListener('click', () => {
      model.ops.splice(k, 1);
      drawCircuit();
      setStatus(`Removed op #${k + 1}. Press Compile & run.`);
    });

    const x = xOf(k), w = 28;

    if (spec.span) {
      const y0 = yOf(0) - 13, h = (n - 1) * rowH + 26;
      g.append(
        svg('rect', { class: 'gate-box', x: x - w / 2, y: y0, width: w, height: h, rx: 5 }),
        svg('text', { class: 'gate-label gate-label--sm', x, y: y0 + h / 2 + 3 }, spec.label),
      );
      if (op.name === 'oracle') {
        g.append(svg('title', {}, `apply_oracle(reg, ${op.a})  →  negate ${ket(op.a, n)}`));
      } else {
        g.append(svg('title', {}, 'apply_diffuser(reg)  →  amplitude amplification'));
      }
    } else if (op.name === 'cnot') {
      const yc = yOf(op.a), yt = yOf(op.b);
      g.append(
        svg('line', { class: 'ctrl-line', x1: x, y1: yc, x2: x, y2: yt }),
        svg('circle', { class: 'ctrl-dot', cx: x, cy: yc, r: 4 }),
        svg('rect', { class: 'gate-box', x: x - w / 2, y: yt - 13, width: w, height: 26, rx: 5 }),
        svg('text', { class: 'gate-label', x, y: yt + 4 }, '⊕'),
        svg('title', {}, `apply_gate_cnot(reg, ${op.a}, ${op.b})`),
      );
    } else {
      const y = yOf(op.a);
      g.append(
        svg('rect', { class: 'gate-box', x: x - w / 2, y: y - 13, width: w, height: 26, rx: 5 }),
        svg('text', { class: 'gate-label', x, y: y + 4 }, spec.label),
        svg('title', {}, op.name === 'measure'
          ? `measure_qubit(reg, ${op.a})`
          : `apply_gate_${op.name}(reg, ${op.a})`),
      );
    }
    el.circuit.append(g);
  });
}

function updateCircuitPlayhead(frame) {
  const idx = frame ? frame.opIndex : -1;
  const ph = el.circuit._playhead;
  if (ph) {
    if (idx >= 0) {
      ph.setAttribute('x', el.circuit._xOf(idx) - el.circuit._colW / 2);
      ph.setAttribute('opacity', 1);
    } else {
      ph.setAttribute('opacity', 0);
    }
  }
  for (const g of el.circuit.querySelectorAll('.gate-g')) {
    const k = Number(g.dataset.index);
    g.dataset.active = String(k === idx);
    g.dataset.done = String(k < idx);
  }
}

/* ── amplitude bars ────────────────────────────────────────────── */

function buildAmps() {
  el.amps.replaceChildren();
  el.amps._rows = [];
  for (let i = 0; i < model.dim; i++) {
    const row = document.createElement('div');
    row.className = 'amp';

    const label = document.createElement('span');
    label.className = 'amp__ket';
    label.textContent = ket(i, model.qubits);

    const track = document.createElement('div');
    track.className = 'amp__track';
    const fill = document.createElement('div');
    fill.className = 'amp__fill';
    fill.style.width = '0%';
    track.append(fill);

    const num = document.createElement('span');
    num.className = 'amp__num';
    num.innerHTML = '<b>0.0%</b><span class="amp__raw">0 + 0i</span>';

    row.append(label, track, num);
    el.amps.append(row);
    el.amps._rows.push({ row, fill, num });
  }
}

function decode(state) {
  const out = [];
  for (let i = 0; i < model.dim; i++) {
    const re = (state[2 * i] ?? 0) / Q14;
    const im = (state[2 * i + 1] ?? 0) / Q14;
    out.push({ re, im, raw: [state[2 * i] ?? 0, state[2 * i + 1] ?? 0], prob: re * re + im * im });
  }
  return out;
}

function renderAmps(frame) {
  const amps = decode(frame.state);
  const touched = new Set();
  if (frame.ev === 'step') { touched.add(frame.i0); touched.add(frame.i1); }

  amps.forEach((a, i) => {
    const { row, fill, num } = el.amps._rows[i];
    const pct = Math.max(0, Math.min(1, a.prob)) * 100;
    fill.style.width = `${pct.toFixed(2)}%`;
    const negative = Math.abs(a.re) >= Math.abs(a.im) ? a.re < 0 : a.im < 0;
    fill.dataset.sign = negative ? '-' : '+';
    num.innerHTML =
      `<b>${pct.toFixed(1)}%</b><span class="amp__raw">${a.raw[0]}${a.raw[1] < 0 ? ' − ' : ' + '}${Math.abs(a.raw[1])}i</span>`;
    row.dataset.active = String(touched.has(i));
  });

  return amps;
}

/* ── stat tiles ────────────────────────────────────────────────── */

function renderStats(frame, amps) {
  const norm = amps.reduce((s, a) => s + a.prob, 0);
  const drift = Math.abs(1 - norm);
  const s = model.stats ?? {};
  const gates = s.gates ?? 0;
  const compute = s.compute_us ?? 0;
  const perGate = gates ? compute / gates : 0;

  const tiles = [
    ['Norm ⟨ψ|ψ⟩', norm.toFixed(4), drift > 0.02,
      'Sum of |amplitude|². Should stay at 1.0000; anything else is lost or invented probability.'],
    ['Q1.14 drift', `${(drift * 100).toFixed(2)}<small>%</small>`, drift > 0.02,
      'How far the norm has wandered from 1 — the accumulated cost of 14-bit rounding.'],
    ['Gates', String(gates), false,
      'apply_gate_* calls, counting the ones the diffuser expands into.'],
    ['Compute', `${compute.toFixed(1)}<small>µs</small>`, false,
      'Untraced pass on this machine — trace emission excluded, same methodology as the README benchmark. Not an AVR figure.'],
    ['Per gate', `${perGate.toFixed(2)}<small>µs</small>`, false,
      'Compute ÷ gates on this host. The ATmega328P @ 16 MHz figure is 175 µs.'],
    ['Amplitudes', `${s.state_bytes ?? 0}<small>/${s.pool_bytes ?? 256} B</small>`, false,
      '4 bytes per basis state, out of the 64-state static pool in quantum_register.c.'],
    ['Events', String(model.frames.length), false,
      'Trace events recorded for this run.'],
  ];

  el.statrow.replaceChildren(...tiles.map(([label, value, warn, title]) => {
    const d = document.createElement('div');
    d.className = 'stat' + (warn ? ' stat--warn' : '');
    if (title) d.title = title;
    d.innerHTML = `<span class="stat__label">${label}</span><span class="stat__value">${value}</span>`;
    return d;
  }));
}

/* ── Bloch spheres ─────────────────────────────────────────────── */

const AZ = 35 * Math.PI / 180;
const EL = 20 * Math.PI / 180;

// screen basis for the chosen camera
const EX = [-Math.sin(AZ), Math.cos(AZ), 0];
const EY = [-Math.cos(AZ) * Math.sin(EL), -Math.sin(AZ) * Math.sin(EL), Math.cos(EL)];
const dot3 = (v, e) => v[0] * e[0] + v[1] * e[1] + v[2] * e[2];

function blochVector(amps, qubit) {
  const mask = 1 << qubit;
  let r00 = 0, r11 = 0, r01re = 0, r01im = 0;

  for (let i = 0; i < amps.length; i++) {
    if (i & mask) { r11 += amps[i].prob; continue; }
    r00 += amps[i].prob;
    const a = amps[i], b = amps[i | mask];
    // rho01 += a * conj(b)
    r01re += a.re * b.re + a.im * b.im;
    r01im += a.im * b.re - a.re * b.im;
  }

  const trace = r00 + r11;
  if (trace <= 1e-9) return { x: 0, y: 0, z: 0, len: 0 };

  const x = 2 * r01re / trace;
  const y = -2 * r01im / trace;
  const z = (r00 - r11) / trace;
  return { x, y, z, len: Math.hypot(x, y, z) };
}

function buildBloch() {
  el.bloch.replaceChildren();
  el.bloch._cells = [];

  const R = 40, C = 62, size = 124;

  for (let q = 0; q < model.qubits; q++) {
    const cell = document.createElement('div');
    cell.className = 'bloch__cell';

    const title = document.createElement('div');
    title.className = 'bloch__title';
    title.textContent = `q${q}`;

    const s = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });

    s.append(
      svg('ellipse', { class: 'sph-equator', cx: C, cy: C, rx: R, ry: R * Math.sin(EL) }),
      svg('ellipse', { class: 'sph-equator', cx: C, cy: C, rx: R * Math.sin(AZ), ry: R }),
      svg('circle', { class: 'sph-outline', cx: C, cy: C, r: R }),
    );

    // axis stubs + poles, labelled so orientation never depends on colour
    const project = (v) => [C + R * dot3(v, EX), C - R * dot3(v, EY)];
    for (const [v, label] of [[[1, 0, 0], 'x'], [[0, 1, 0], 'y'], [[0, 0, 1], '|0⟩'], [[0, 0, -1], '|1⟩']]) {
      const [px, py] = project(v);
      s.append(svg('line', { class: 'sph-axis', x1: C, y1: C, x2: px, y2: py }));
      const [lx, ly] = project(v.map((c) => c * 1.22));
      s.append(svg('text', { class: 'sph-axis-label', x: lx, y: ly + 3 }, label));
    }

    const drop = svg('line', { class: 'sph-drop', x1: C, y1: C, x2: C, y2: C });
    const vec = svg('line', { class: 'sph-vec', x1: C, y1: C, x2: C, y2: C });
    const tip = svg('circle', { class: 'sph-tip', cx: C, cy: C, r: 4 });
    s.append(drop, vec, tip);

    const readout = document.createElement('div');
    readout.className = 'bloch__readout';
    readout.textContent = '‖r‖ 0.00';

    cell.append(title, s, readout);
    el.bloch.append(cell);
    el.bloch._cells.push({ vec, tip, drop, readout, C, R, project });
  }
}

function renderBloch(amps) {
  el.bloch._cells.forEach((cell, q) => {
    const r = blochVector(amps, q);
    const [px, py] = cell.project([r.x, r.y, r.z]);
    const [dx, dy] = cell.project([r.x, r.y, 0]);

    cell.vec.setAttribute('x2', px);
    cell.vec.setAttribute('y2', py);
    cell.tip.setAttribute('cx', px);
    cell.tip.setAttribute('cy', py);
    cell.drop.setAttribute('x1', px);
    cell.drop.setAttribute('y1', py);
    cell.drop.setAttribute('x2', dx);
    cell.drop.setAttribute('y2', dy);

    const pure = r.len > 0.97;
    cell.readout.textContent = `‖r‖ ${r.len.toFixed(2)}${pure ? ' pure' : ' mixed'}`;
  });
}

/* ── source panel ──────────────────────────────────────────────── */

async function loadSources() {
  try {
    const files = await engine.sources();
    el.srcfile.replaceChildren();
    for (const f of files) {
      model.sources.set(f.path, f.text);
      const o = document.createElement('option');
      o.value = f.path;
      o.textContent = f.path;
      el.srcfile.append(o);
    }
    el.srcfile.value = 'src/quantum_core.c';
    renderSource('src/quantum_core.c');
  } catch (err) {
    setStatus(`Could not load sources: ${err}`, 'error');
  }
}

/* Top-level `{ … }` blocks, so the panel can shade the function being executed.
 * Good enough for this codebase: plain C, no braces inside strings. */
function findFunctionRanges(text) {
  const lines = text.split('\n');
  const ranges = [];
  let depth = 0, start = -1, inBlockComment = false;

  lines.forEach((line, idx) => {
    let src = line;
    if (inBlockComment) {
      const close = src.indexOf('*/');
      if (close === -1) return;
      src = src.slice(close + 2);
      inBlockComment = false;
    }
    src = src.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    const open = src.indexOf('/*');
    if (open !== -1) { inBlockComment = true; src = src.slice(0, open); }

    for (const ch of src) {
      if (ch === '{') { if (depth === 0) start = idx + 1; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && start > 0) { ranges.push({ start, end: idx + 1 }); start = -1; }
      }
    }
  });
  return ranges;
}

function renderSource(pathname) {
  const text = model.sources.get(pathname) ?? '';
  el.code.replaceChildren();
  model.codeLines = [];
  model.lastHit = -1;
  model.funcRanges = findFunctionRanges(text);
  model.lastScope = null;

  const frag = document.createDocumentFragment();
  text.split('\n').forEach((src, idx) => {
    const line = document.createElement('div');
    line.className = 'code__line';

    const no = document.createElement('span');
    no.className = 'code__no';
    no.textContent = String(idx + 1);

    const code = document.createElement('span');
    code.className = 'code__src';
    code.textContent = src || ' ';

    line.append(no, code);
    frag.append(line);
    model.codeLines.push(line);
  });
  el.code.append(frag);
}

function highlightLine(lineNo) {
  const isCore = el.srcfile.value === 'src/quantum_core.c';
  const target = isCore && lineNo > 0 ? lineNo : -1;
  if (target === model.lastHit) return;

  if (model.lastHit > 0 && model.codeLines[model.lastHit - 1]) {
    model.codeLines[model.lastHit - 1].dataset.hit = 'false';
  }
  model.lastHit = target;

  // shade the enclosing function so the hit line always has visible context
  const scope = target > 0
    ? model.funcRanges?.find((r) => target >= r.start && target <= r.end) ?? null
    : null;

  if (scope !== model.lastScope) {
    for (const r of [model.lastScope, scope]) {
      if (!r) continue;
      const on = r === scope;
      for (let i = r.start; i <= r.end; i++) {
        if (model.codeLines[i - 1]) model.codeLines[i - 1].dataset.scope = String(on);
      }
    }
    model.lastScope = scope;
  }

  if (target > 0 && model.codeLines[target - 1]) {
    const node = model.codeLines[target - 1];
    node.dataset.hit = 'true';
    const box = el.code.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    if (r.top < box.top + 24 || r.bottom > box.bottom - 24) {
      el.code.scrollTop += (r.top - box.top) - box.height / 2;
    }
  }
}

/* ── playback ──────────────────────────────────────────────────── */

function describe(frame) {
  switch (frame.ev) {
    case 'meta':      return `register initialised — ${frame.qubits} qubits, dim ${frame.dim}`;
    case 'op_begin':  return `▸ op #${frame.index + 1}  ${frame.name.toUpperCase()}${frame.a >= 0 ? ` ${frame.a}` : ''}${frame.b >= 0 ? `,${frame.b}` : ''}`;
    case 'gate_begin':return `  enter ${frame.op}  (quantum_core.c:${frame.line})`;
    case 'step':      return `    combine ${ket(frame.i0, model.qubits)} ↔ ${ket(frame.i1, model.qubits)}  (line ${frame.line})`;
    case 'note':      return `    ${frame.what} = ${frame.value}  (line ${frame.line})`;
    case 'gate_end':  return `  leave gate`;
    case 'op_end':    return frame.result >= 0 ? `◂ op #${frame.index + 1} → measured ${frame.result}` : `◂ op #${frame.index + 1} done`;
    case 'done':      return `trace complete — ${frame.ops} ops, ${frame.gates} gates, ${frame.compute_us.toFixed(2)} µs pure compute`;
    default:          return frame.ev;
  }
}

function show(index) {
  if (!model.frames.length) return;
  model.cursor = Math.max(0, Math.min(model.frames.length - 1, index));
  const frame = model.frames[model.cursor];

  const amps = renderAmps(frame);
  renderBloch(amps);
  renderStats(frame, amps);
  updateCircuitPlayhead(frame);
  highlightLine(frame.line ?? -1);

  el.scrub.value = String(model.cursor);
  el.counter.textContent = `${model.cursor + 1} / ${model.frames.length}`;
  setStatus(describe(frame));
}

function setPlaying(on) {
  model.playing = on;
  el.tpPlay.textContent = on ? '❚❚' : '▶';
  el.tpPlay.dataset.playing = String(on);
  clearTimeout(model.timer);
  if (on) tick();
}

function tick() {
  if (!model.playing) return;
  if (model.cursor >= model.frames.length - 1) { setPlaying(false); return; }

  const delay = Number(el.speed.value);
  if (delay === 0) {
    // "max": chew through a chunk per animation frame
    const chunk = Math.max(1, Math.ceil(model.frames.length / 120));
    show(model.cursor + chunk);
    model.timer = setTimeout(tick, 16);
  } else {
    show(model.cursor + 1);
    model.timer = setTimeout(tick, delay);
  }
}

/* ── run ───────────────────────────────────────────────────────── */

async function run() {
  setPlaying(false);
  el.run.disabled = true;
  setStatus(engine.kind === 'gcc'
    ? 'Compiling core with gcc -DQTRACE …'
    : 'Running qcore.wasm …');

  const body = {
    qubits: model.qubits,
    mode: el.mode.value,
    seed: el.seed.value.trim() || undefined,
    ops: model.ops.map((o) => ({ name: o.name, a: o.a, b: o.b })),
  };

  const frames = [];
  let carry = { state: [], line: -1, opIndex: -1 };
  let meta = null;
  let stats = null;
  const problems = [];

  const onEvent = (e) => {
    if (e.ev === 'build_ok') {
      setStatus(e.ms ? `Built in ${e.ms} ms · ${e.command}${e.stderr ? `\n${e.stderr}` : ''}`
                     : `Running ${e.command}`, 'ok');
      return;
    }
    if (e.ev === 'build_error') { problems.push(e.detail); return; }
    if (e.ev === 'exit')        { if (e.stderr) problems.push(e.stderr); return; }
    if (e.ev === 'error')       { problems.push(e.msg); return; }
    if (e.ev === 'truncated')   { problems.push(`trace truncated at ${e.limit} events`); return; }

    if (e.ev === 'meta') meta = e;
    if (e.ev === 'done') stats = e;
    if (e.ev === 'op_begin') carry.opIndex = e.index;

    const frame = {
      ...e,
      state: e.state ?? carry.state,
      line: e.line ?? carry.line,
      opIndex: carry.opIndex,
    };
    carry = { state: frame.state, line: frame.line, opIndex: carry.opIndex };
    frames.push(frame);
  };

  try {
    await engine.run(body, onEvent);
  } catch (err) {
    problems.push(String(err.message ?? err));
  } finally {
    el.run.disabled = false;
  }

  if (problems.length && !frames.length) {
    setStatus(problems.join('\n'), 'error');
    return;
  }

  if (meta) {
    model.dim = meta.dim;
    if (meta.qubits !== model.qubits) {
      model.qubits = meta.qubits;
      el.qubits.value = String(meta.qubits);
      drawCircuit();
    }
    buildAmps();
    buildBloch();
  }

  model.frames = frames;
  model.stats = stats ?? {};
  el.scrub.max = String(Math.max(0, frames.length - 1));
  show(0);

  const head = stats
    ? `${stats.ops} ops · ${stats.gates} gate calls · ${frames.length} trace events · ` +
      `${stats.compute_us.toFixed(2)} µs pure compute (${stats.trace_us.toFixed(0)} µs with tracing) · ${engine.label}`
    : `${frames.length} trace events`;
  setStatus(problems.length ? `${head}\n${problems.join('\n')}` : head,
            problems.length ? 'error' : 'ok');
}

/* ── wiring ────────────────────────────────────────────────────── */

el.palette.addEventListener('click', (e) => {
  const btn = e.target.closest('.gate-btn');
  if (!btn) return;
  pendingOp = btn.dataset.op;
  refreshArgs();
  addOp(pendingOp);
});

// keep the arg selectors labelled for whichever gate the user hovers/focuses
el.palette.addEventListener('pointerover', (e) => {
  const btn = e.target.closest('.gate-btn');
  if (!btn || btn.dataset.op === pendingOp) return;
  pendingOp = btn.dataset.op;
  refreshArgs();
});

el.qubits.addEventListener('change', () => {
  model.qubits = Number(el.qubits.value);
  model.dim = 1 << model.qubits;
  model.ops = model.ops.filter((o) =>
    (o.name === 'oracle' ? o.a < model.dim : o.a < model.qubits) &&
    (o.b < 0 || o.b < model.qubits));
  refreshArgs();
  drawCircuit();
  buildAmps();
  buildBloch();
  setStatus(`Register resized to ${model.qubits} qubits (${model.dim} amplitudes).`);
});

el.preset.addEventListener('change', () => {
  const p = PRESETS[el.preset.value];
  if (!p) return;
  model.qubits = p.qubits;
  model.dim = 1 << p.qubits;
  el.qubits.value = String(p.qubits);
  model.ops = p.ops.map(([name, a = -1, b = -1]) => ({ name, a, b }));
  refreshArgs();
  drawCircuit();
  buildAmps();
  buildBloch();
  setStatus(`Loaded preset "${el.preset.value}" — press Compile & run.`);
  el.preset.value = '';
});

el.clear.addEventListener('click', () => {
  model.ops = [];
  drawCircuit();
  setStatus('Circuit cleared.');
});

el.run.addEventListener('click', run);
el.srcfile.addEventListener('change', () => renderSource(el.srcfile.value));

el.scrub.addEventListener('input', () => { setPlaying(false); show(Number(el.scrub.value)); });
el.tpFirst.addEventListener('click', () => { setPlaying(false); show(0); });
el.tpLast.addEventListener('click', () => { setPlaying(false); show(model.frames.length - 1); });
el.tpPrev.addEventListener('click', () => { setPlaying(false); show(model.cursor - 1); });
el.tpNext.addEventListener('click', () => { setPlaying(false); show(model.cursor + 1); });
el.tpPlay.addEventListener('click', () => {
  if (!model.frames.length) return;
  if (!model.playing && model.cursor >= model.frames.length - 1) show(0);
  setPlaying(!model.playing);
});

el.theme.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('eqe-theme', next);
});

/* ── how to use ─────────────────────────────────────────────────
 * Opens by itself the first time someone lands here, and on #how-to-use
 * so the project page can link straight into it. */

el.help.addEventListener('click', () => el.guide.showModal());
el.guideClose.addEventListener('click', () => el.guide.close());
el.guide.addEventListener('click', (e) => { if (e.target === el.guide) el.guide.close(); });
el.guide.addEventListener('close', () => localStorage.setItem('eqe-guide-seen', '1'));

if (location.hash === '#how-to-use' || !localStorage.getItem('eqe-guide-seen')) {
  el.guide.showModal();
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  // Esc is handled by the dialog itself; transport keys must not act behind it
  if (el.guide.open) return;
  if (e.key === '?') { e.preventDefault(); el.guide.showModal(); }
  else if (e.key === ' ') { e.preventDefault(); el.tpPlay.click(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); el.tpNext.click(); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); el.tpPrev.click(); }
  else if (e.key === 'Home')       { e.preventDefault(); el.tpFirst.click(); }
  else if (e.key === 'End')        { e.preventDefault(); el.tpLast.click(); }
});

/* ── boot ──────────────────────────────────────────────────────── */

const savedTheme = localStorage.getItem('eqe-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

el.qubits.value = '2';
model.qubits = 2;
model.dim = 4;
pendingOp = 'h';
refreshArgs();
drawCircuit();
buildAmps();
buildBloch();

// start on the Bell preset so the first screen is never empty
el.preset.value = 'bell';
el.preset.dispatchEvent(new Event('change'));

await engine.init();
el.engineBadge.textContent = engine.label;
el.engineBadge.dataset.kind = engine.kind;
await loadSources();
setStatus(`Engine: ${engine.label}. Loaded preset "bell" — press Compile & run.`);
