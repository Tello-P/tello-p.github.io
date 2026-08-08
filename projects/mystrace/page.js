/* Behaviour for the MyStrace page: the terminal replay, the control-loop
   stepper and the PTRACE_PEEKDATA animation. Three independent widgets — each
   one is skipped if its markup is not on the page. */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

/* ── the trace ─────────────────────────────────────────────────────────────
   Verbatim output of `mystrace /bin/echo hola` on x86_64, plus the one-line
   explanation each call gets in the side panel. */

const KERNEL_SERVICES = {
  brk: "Moves the program break, adjusting the size of the heap. This is the raw allocation primitive that sits underneath malloc.",
  access: "Checks permissions on a path without opening it. The dynamic linker uses it to probe whether a candidate library exists.",
  openat: "Opens a file relative to a directory descriptor and returns a file descriptor.",
  newfstatat: "Retrieves metadata — size, permissions, type — for a path, without opening it.",
  fstat: "The same metadata query, addressed by an already open file descriptor.",
  read: "Copies bytes from a file descriptor into a buffer in the process's memory.",
  close: "Releases a file descriptor.",
  mmap: "Maps memory into the process's address space. This is how shared libraries are loaded.",
  mprotect: "Changes the protection on a mapped region — typically to drop write permission once relocation is complete.",
  arch_prctl: "Sets architecture-specific process state, such as the base register used for thread-local storage.",
  set_tid_address: "Registers the address at which the kernel should clear the thread ID on exit.",
  set_robust_list: "Declares the thread's robust futex list, so held mutexes are released if the thread dies.",
  rseq: "Registers a restartable sequence, a concurrency optimisation the C library sets up at startup.",
  getrandom: "Requests random bytes from the kernel. glibc uses them for the stack canary and hash seeds.",
  prlimit64: "Reads or modifies the process's resource limits.",
  write: "Writes bytes from a buffer to a file descriptor. This is the call that finally puts the text on the screen.",
  exit_group: "Terminates every thread in the process. The last system call any program makes.",
};

/* name, syscall number, value of rax at the exit stop, buffer read (if any) */
const S = (n, id, r, d) => ({ n, id, r, d });

const TRACE = [
  { t: 'prog', x: '/bin/echo hola' },
  S('newfstatat', 262, '0x0'), S('openat', 257, '0x3', '/etc/ld.so.cache'),
  S('fstat', 5, '0x0'), S('mmap', 9, '0x7f58db6ab000'), S('close', 3, '0x0'),
  S('brk', 12, '0x55d79bccf000'), S('mmap', 9, '0x7f58db6a9000'),
  S('access', 21, 'ERROR (-2)'), S('newfstatat', 262, '0x0'),
  S('openat', 257, '0x3', '/usr/lib/libc.so.6'), S('read', 0, '0x400', 'ELF'),
  S('fstat', 5, '0x0'), S('mmap', 9, '0x7f58db400000'), S('mmap', 9, '0x7f58db424000'),
  S('mmap', 9, '0x7f58db59c000'), S('mmap', 9, '0x7f58db612000'), S('mmap', 9, '0x7f58db618000'),
  S('close', 3, '0x0'), S('mmap', 9, '0x7f58db6a6000'), S('arch_prctl', 158, '0x0'),
  S('set_tid_address', 218, '0x930ec'), S('set_robust_list', 273, '0x0'), S('rseq', 334, '0x0'),
  S('getrandom', 318, '0x10'), S('mprotect', 10, '0x0'), S('mprotect', 10, '0x0'),
  S('mprotect', 10, '0x0'), S('prlimit64', 302, '0x0'), S('getrandom', 318, '0x8'),
  S('brk', 12, '0x55d79bccf000'), S('brk', 12, '0x55d79bcf0000'),
  S('openat', 257, '0x3', '/usr/lib/locale/locale-archive'),
  S('fstat', 5, '0x0'), S('mmap', 9, '0x7f58dae00000'), S('close', 3, '0x0'),
  S('fstat', 5, '0x0'), S('write', 1, '0xf', 'hola\\n'),
  S('close', 3, '0x0'), S('close', 3, '0x0'), S('exit_group', 231, null),
  { t: 'meta', x: '[mystrace] Process exited normally with status 0' },
];

/* ── terminal replay ─────────────────────────────────────────────────────── */

function initTerminal() {
  const out = document.getElementById('out');
  const side = document.getElementById('side');
  const bPlay = document.getElementById('play');
  const bSpeed = document.getElementById('speed');
  const bRestart = document.getElementById('restart');
  if (!out || !side || !bPlay || !bSpeed || !bRestart) return;

  let i = 0;
  let timer = null;
  let playing = true;
  let speed = 1;
  let cursor = null;

  function showInfo(name) {
    side.innerHTML =
      '<div class="side-tag">System call</div>' +
      '<div class="side-name">' + esc(name) + '</div>' +
      '<div class="side-body">' +
      esc(KERNEL_SERVICES[name] || 'A kernel service requested by the process.') +
      '</div>';
  }

  function emit(e) {
    if (e.n) {
      const el = document.createElement('span');
      el.className = 'ln sys';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      const res = e.r === null ? ''
        : e.r.indexOf('ERROR') === 0
          ? ' | Result: <span class="ev">' + e.r + '</span>'
          : ' | Result: <span class="rv">' + e.r + '</span>';
      el.innerHTML =
        'Syscall: <span class="nm">' + pad(e.n, 15) + '</span>' +
        '<span class="id">(ID: ' + String(e.id).padStart(3, ' ') + ')</span>' + res + '\n';

      const select = () => {
        const prev = out.querySelector('.sel');
        if (prev) prev.classList.remove('sel');
        el.classList.add('sel');
        showInfo(e.n);
      };
      el.addEventListener('click', select);
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); }
      });
      out.appendChild(el);

      if (e.d) {
        const d = document.createElement('span');
        d.className = 'ln data';
        d.textContent = '\n---------------\nDATA: ' + e.d + '\n-----------------\n';
        out.appendChild(d);
      }
    } else {
      const el = document.createElement('span');
      el.className = 'ln ' + (e.t === 'prog' ? 'prog' : 'meta');
      el.textContent = (e.t === 'meta' ? '\n' : '') + e.x + '\n';
      out.appendChild(el);
    }
    out.scrollTop = out.scrollHeight;
  }

  function finish() {
    playing = false;
    clearTimeout(timer);
    timer = null;
    bPlay.textContent = 'Replay';
    if (cursor) { cursor.remove(); cursor = null; }
  }

  function tick() {
    if (i >= TRACE.length) { finish(); return; }
    const e = TRACE[i++];
    if (cursor) { cursor.remove(); cursor = null; }
    emit(e);
    cursor = document.createElement('span');
    cursor.className = 'cursor';
    out.appendChild(cursor);
    out.scrollTop = out.scrollHeight;
    timer = setTimeout(tick, (e.d ? 360 : 150) / speed);
  }

  /* With reduced motion the whole trace is laid down at once; the replay
     controls still work for anyone who asks for one. */
  function renderAll() {
    clearTimeout(timer);
    out.innerHTML = '';
    TRACE.forEach(emit);
    i = TRACE.length;
    cursor = null;
    finish();
  }

  function restart() {
    clearTimeout(timer);
    out.innerHTML = '';
    i = 0;
    cursor = null;
    playing = true;
    bPlay.textContent = 'Pause';
    tick();
  }

  bPlay.addEventListener('click', () => {
    if (playing) {
      clearTimeout(timer);
      playing = false;
      bPlay.textContent = 'Resume';
    } else if (i >= TRACE.length) {
      restart();
    } else {
      playing = true;
      bPlay.textContent = 'Pause';
      tick();
    }
  });

  bSpeed.addEventListener('click', () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    bSpeed.innerHTML = speed + '&times;';
    bSpeed.classList.toggle('on', speed !== 1);
  });

  bRestart.addEventListener('click', restart);

  if (REDUCED) renderAll(); else tick();
}

/* ── control-loop stepper ────────────────────────────────────────────────── */

const R = (r, v, m, hot) => ({ r, v, m, hot });

const PHASES = [
  {
    t: 'Resume the tracee', c: 'PTRACE_SYSCALL',
    note: "The tracer hands control back to the traced process and instructs the kernel to stop it at the next syscall boundary. At this instant the register file still holds the previous stop's values — reading it here is precisely the mistake that produced stale and duplicated output in my first implementation.",
    regs: [R('orig_rax', '—', 'not yet sampled'), R('rdi', '—', ''), R('rsi', '—', ''), R('rax', '—', '')],
    dim: true,
  },
  {
    t: 'Wait for the stop', c: 'waitpid()',
    note: 'The tracer blocks. There is nothing to read yet: the tracee continues executing in its own address space until it reaches a syscall instruction and the kernel freezes it.',
    regs: [R('orig_rax', '—', 'tracee still executing'), R('rdi', '—', ''), R('rsi', '—', ''), R('rax', '—', '')],
    dim: true,
  },
  {
    t: 'Validate the stop', c: 'WIFEXITED / WIFSTOPPED',
    note: 'waitpid has returned, but not always for the same reason. Has the process exited? Is this a syscall stop, identified by SIGTRAP|0x80 thanks to PTRACE_O_TRACESYSGOOD? Or an ordinary signal that must be forwarded on the next resume? Only the syscall stop proceeds to decoding.',
    regs: [R('orig_rax', '—', 'stop confirmed'), R('rdi', '—', ''), R('rsi', '—', ''), R('rax', '—', '')],
    dim: true,
  },
  {
    t: 'Entry: the arguments', c: 'PTRACE_GETREGS · entry = 1',
    note: 'The inbound stop, before the kernel performs the work. orig_rax carries the service number and the six ABI argument registers carry the operands. rax has no meaningful value yet.',
    regs: [
      R('orig_rax', '257', 'openat — the system call identifier', 1),
      R('rdi', '0xffffff9c', 'AT_FDCWD: resolve relative to the current directory', 1),
      R('rsi', '0x7ffd4a2b1e40', "pointer to the path, in the tracee's memory", 1),
      R('rdx', '0x80000', 'O_RDONLY | O_CLOEXEC', 1),
      R('rax', '—', 'no value at this stop'),
    ],
  },
  {
    t: 'Exit: the result', c: 'PTRACE_GETREGS · entry = 0',
    note: "The outbound stop for the same call, now serviced. rax carries the kernel's answer. With both halves in hand the tracer emits the complete line and resets entry for the next call.",
    regs: [
      R('orig_rax', '257', 'still openat'),
      R('rdi', '0xffffff9c', ''), R('rsi', '0x7ffd4a2b1e40', ''),
      R('rax', '0x3', 'file descriptor 3 — opened successfully', 1),
    ],
  },
];

function initStepper() {
  const stepsEl = document.getElementById('steps');
  const regsEl = document.getElementById('regs');
  const noteEl = document.getElementById('stageNote');
  if (!stepsEl || !regsEl || !noteEl) return;

  function render(k, focus) {
    const tabs = stepsEl.children;
    for (let j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('on', j === k);
      tabs[j].setAttribute('aria-selected', j === k);
      tabs[j].tabIndex = j === k ? 0 : -1;
    }
    if (focus) tabs[k].focus();

    const p = PHASES[k];
    noteEl.textContent = p.note;
    regsEl.innerHTML = p.regs.map((x) =>
      '<tr class="' + (x.hot ? 'hot' : p.dim ? 'dim' : '') + '">' +
      '<td>' + x.r + '</td><td>' + x.v + '</td>' +
      '<td class="note">' + x.m + '</td></tr>').join('');
  }

  PHASES.forEach((p, k) => {
    const b = document.createElement('button');
    b.className = 'step';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'stage');
    b.innerHTML =
      '<span class="n">' + (k + 1) + '</span>' +
      '<span>' + p.t + '<span class="c">' + p.c + '</span></span>';
    b.addEventListener('click', () => render(k));
    b.addEventListener('keydown', (ev) => {
      const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1
        : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      render((k + step + PHASES.length) % PHASES.length, true);
    });
    stepsEl.appendChild(b);
  });

  /* Opens on the entry stop — the stage where the arguments appear. */
  render(3);
}

/* ── PTRACE_PEEKDATA, one machine word at a time ─────────────────────────── */

const PEEK_PATH = '/etc/ld.so.cache';

function initPeek() {
  const wordsEl = document.getElementById('words');
  const asmEl = document.getElementById('assembled');
  const again = document.getElementById('peekAgain');
  if (!wordsEl || !asmEl || !again) return;

  let timers = [];

  function peek() {
    timers.forEach(clearTimeout);
    timers = [];

    const buf = PEEK_PATH + '\0';
    const chunks = [];
    for (let k = 0; k < buf.length; k += 8) chunks.push(buf.slice(k, k + 8));

    wordsEl.innerHTML = chunks.map((c, k) => {
      const shown = [...c].map((ch) => (ch === '\0' ? '<span class="nul">\\0</span>' : esc(ch))).join('');
      const addr = '0x…1e' + (0x40 + k * 8).toString(16);
      return '<div class="word" data-k="' + k + '">' +
        '<span class="h">' + addr + '</span>' +
        '<span class="b">' + shown + '</span></div>';
    }).join('');

    const reveal = (k) => {
      wordsEl.querySelector('[data-k="' + k + '"]').classList.add('in');
      const c = chunks[k];
      asmEl.dataset.acc = (asmEl.dataset.acc || '') + c.replace('\0', '');
      asmEl.textContent = asmEl.dataset.acc +
        (c.indexOf('\0') > -1 ? '   ← NUL reached, the read stops here' : '');
    };

    asmEl.dataset.acc = '';
    asmEl.textContent = ' ';

    if (REDUCED) {
      chunks.forEach((_, k) => reveal(k));
      return;
    }
    chunks.forEach((_, k) => timers.push(setTimeout(() => reveal(k), 430 * (k + 1))));
  }

  again.addEventListener('click', peek);
  peek();
}

initTerminal();
initStepper();
initPeek();
