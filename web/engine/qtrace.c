/* qtrace - execution tracer for the Embedded Qubit Engine web debugger.
 *
 * Links against the real C core in src/ (compiled with -DQTRACE) and streams
 * newline-delimited JSON events describing every gate, every inner-loop step
 * and the full Q1.14 state vector at each point.
 *
 * Two front-ends, one code path:
 *   native  - main() reads the program from stdin, writes NDJSON to stdout
 *   wasm    - qt_run(program) is called from JS; stdout lines are captured by
 *             Emscripten's print hook
 * Both funnel through run_program(), so the browser build and the local build
 * cannot drift apart.
 *
 * Program text is one directive per line:
 *
 *   qubits <n>          register width            (default 2)
 *   mode   gate|step    trace granularity         (default step)
 *   seed   <u64>        RNG seed for measurements (default engine default)
 *   op     h <t>
 *   op     x <t>
 *   op     z <t>
 *   op     cnot <c> <t>
 *   op     oracle <index>
 *   op     diffuser
 *   op     measure <t>
 *   run
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdint.h>

#include "quantum_core.h"
#include "quantum_register.h"
#include "fixed_point.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#define MAX_OPS    512
#define MAX_EVENTS 400000

/* Warm-up budget before the timed pass (see qt_run). */
#define WARMUP_MAX_ITERS  200
#define WARMUP_BUDGET_US  20000.0

typedef struct {
    char name[16];
    int  a;
    int  b;
} op_t;

static op_t  ops[MAX_OPS];
static int   op_count = 0;
static int   trace_steps = 1;
static long  event_count = 0;
static int   gate_depth = 0;
static int   truncated = 0;
static int   emit_enabled = 1;
static int   gate_calls = 0;

/* ---- JSON emission ---------------------------------------------------- */

static int budget_ok(void) {
    if (!emit_enabled) return 0;
    if (event_count >= MAX_EVENTS) {
        if (!truncated) {
            truncated = 1;
            printf("{\"ev\":\"truncated\",\"limit\":%d}\n", MAX_EVENTS);
        }
        return 0;
    }
    event_count++;
    return 1;
}

static void emit_state(const quantum_register_t *reg) {
    printf(",\"state\":[");
    for (uint16_t i = 0; i < reg->dim; i++) {
        printf("%s%d,%d", i ? "," : "", reg->state[i].real, reg->state[i].imag);
    }
    printf("]");
}

/* ---- hooks called from src/quantum_core.c ------------------------------ */

void qt_gate_begin(const void *r, const char *op, int a, int b, int line) {
    const quantum_register_t *reg = (const quantum_register_t *)r;
    if (emit_enabled) gate_calls++;   /* counted on the traced pass only */
    if (!budget_ok()) { gate_depth++; return; }
    printf("{\"ev\":\"gate_begin\",\"op\":\"%s\",\"a\":%d,\"b\":%d,\"line\":%d,\"depth\":%d",
           op, a, b, line, gate_depth);
    emit_state(reg);
    printf("}\n");
    gate_depth++;
}

void qt_gate_end(const void *r) {
    const quantum_register_t *reg = (const quantum_register_t *)r;
    gate_depth--;
    if (!budget_ok()) return;
    printf("{\"ev\":\"gate_end\",\"depth\":%d", gate_depth);
    emit_state(reg);
    printf("}\n");
}

void qt_step(const void *r, int line, int i0, int i1) {
    const quantum_register_t *reg = (const quantum_register_t *)r;
    if (!trace_steps) return;
    if (!budget_ok()) return;
    printf("{\"ev\":\"step\",\"line\":%d,\"i0\":%d,\"i1\":%d,\"depth\":%d",
           line, i0, i1, gate_depth);
    emit_state(reg);
    printf("}\n");
}

void qt_note(const void *r, int line, const char *what, int value) {
    (void)r;
    if (!trace_steps) return;
    if (!budget_ok()) return;
    printf("{\"ev\":\"note\",\"line\":%d,\"what\":\"%s\",\"value\":%d,\"depth\":%d}\n",
           line, what, value, gate_depth);
}

/* ---- program parsing --------------------------------------------------- */

/* Reset every global so a WASM module can serve many runs in one page load
 * and still behave exactly like a freshly spawned native process. */
static void reset_state(void) {
    op_count = 0;
    trace_steps = 1;
    event_count = 0;
    gate_depth = 0;
    truncated = 0;
    emit_enabled = 1;
    gate_calls = 0;
}

static void parse_line(const char *line, int *qubits, uint64_t *seed, int *have_seed) {
    {
        char kind[32];
        if (sscanf(line, "%31s", kind) != 1) return;

        if (!strcmp(kind, "qubits")) {
            sscanf(line, "%*s %d", qubits);
        } else if (!strcmp(kind, "mode")) {
            char m[16] = {0};
            sscanf(line, "%*s %15s", m);
            trace_steps = strcmp(m, "gate") != 0;
        } else if (!strcmp(kind, "seed")) {
            unsigned long long s = 0;
            if (sscanf(line, "%*s %llu", &s) == 1) { *seed = (uint64_t)s; *have_seed = 1; }
        } else if (!strcmp(kind, "op")) {
            if (op_count >= MAX_OPS) return;
            op_t o = { {0}, -1, -1 };
            sscanf(line, "%*s %15s %d %d", o.name, &o.a, &o.b);
            ops[op_count++] = o;
        }
    }
}

static void parse_program(const char *text, int *qubits, uint64_t *seed, int *have_seed) {
    char line[256];
    size_t n = 0;

    for (const char *p = text; ; p++) {
        if (*p == '\n' || *p == '\0') {
            line[n] = '\0';
            if (n) parse_line(line, qubits, seed, have_seed);
            n = 0;
            if (*p == '\0') break;
        } else if (n + 1 < sizeof line) {
            line[n++] = *p;
        }
    }
}

/* ---- execution ---------------------------------------------------------- */

static void run_ops(quantum_register_t *reg) {
    for (int k = 0; k < op_count; k++) {
        op_t *o = &ops[k];

        if (emit_enabled) {
            printf("{\"ev\":\"op_begin\",\"index\":%d,\"name\":\"%s\",\"a\":%d,\"b\":%d}\n",
                   k, o->name, o->a, o->b);
        }

        int result = -1;
        if      (!strcmp(o->name, "h"))        apply_gate_h(reg, (uint8_t)o->a);
        else if (!strcmp(o->name, "x"))        apply_gate_x(reg, (uint8_t)o->a);
        else if (!strcmp(o->name, "z"))        apply_gate_z(reg, (uint8_t)o->a);
        else if (!strcmp(o->name, "cnot"))     apply_gate_cnot(reg, (uint8_t)o->a, (uint8_t)o->b);
        else if (!strcmp(o->name, "oracle"))   apply_oracle(reg, (uint16_t)o->a);
        else if (!strcmp(o->name, "diffuser")) apply_diffuser(reg);
        else if (!strcmp(o->name, "measure"))  result = measure_qubit(reg, (uint8_t)o->a);
        else {
            if (emit_enabled) {
                printf("{\"ev\":\"error\",\"msg\":\"unknown op '%s'\"}\n", o->name);
            }
            continue;
        }

        if (emit_enabled) {
            printf("{\"ev\":\"op_end\",\"index\":%d,\"result\":%d", k, result);
            emit_state(reg);
            printf("}\n");
        }
    }
}

/* ---- entry points ------------------------------------------------------- */

/* Runs one program and writes the trace to stdout. Callable repeatedly. */
EMSCRIPTEN_KEEPALIVE
int qt_run(const char *program) {
    int qubits = 2;
    uint64_t seed = 0;
    int have_seed = 0;

    reset_state();
    parse_program(program, &qubits, &seed, &have_seed);

    /* seed_quantum_rng(0) restores the engine's documented default, so an
     * unseeded browser run matches an unseeded freshly-spawned native run. */
    const uint64_t effective_seed = have_seed ? seed : 0;

    seed_quantum_rng(effective_seed);
    quantum_register_t reg = init_register((uint8_t)qubits);
    if (reg.state == NULL) {
        printf("{\"ev\":\"error\",\"msg\":\"init_register(%d) failed - MAX_QUBITS is %d\"}\n",
               qubits, MAX_QUBITS);
        fflush(stdout);
        return 1;
    }

    /* The circuit is run three times: a discarded warm-up, a silent timed pass,
     * then the traced pass that produces the events.
     *
     * Timing the traced pass would be meaningless — it is dominated by JSON
     * emission (~5x native, ~50x on wasm where every line crosses into JS).
     * Excluding that mirrors the README's "pure compute" methodology, which
     * likewise excludes Serial overhead. The warm-up exists because wasm starts
     * baseline-compiled and an unwarmed reading runs ~30x slow; it loops until
     * the JIT has had enough iterations to tier up, bounded so a big circuit
     * cannot stall the page.
     *
     * Re-seeding and re-initialising before every pass keeps every run
     * bit-identical, measurement outcomes included. */
    emit_enabled = 0;
    {
        struct timespec w0, w1;
        clock_gettime(CLOCK_MONOTONIC, &w0);
        for (int i = 0; i < WARMUP_MAX_ITERS; i++) {
            /* re-init each iteration so warm-up does the same work as the
             * timed pass, instead of iterating on an ever-degrading state */
            seed_quantum_rng(effective_seed);
            reg = init_register((uint8_t)qubits);
            run_ops(&reg);
            clock_gettime(CLOCK_MONOTONIC, &w1);
            double elapsed_us = (w1.tv_sec - w0.tv_sec) * 1e6
                              + (w1.tv_nsec - w0.tv_nsec) / 1e3;
            if (elapsed_us > WARMUP_BUDGET_US) break;
        }
    }

    seed_quantum_rng(effective_seed);
    reg = init_register((uint8_t)qubits);

    struct timespec c0, c1;
    clock_gettime(CLOCK_MONOTONIC, &c0);
    run_ops(&reg);
    clock_gettime(CLOCK_MONOTONIC, &c1);
    double compute_us = (c1.tv_sec - c0.tv_sec) * 1e6 + (c1.tv_nsec - c0.tv_nsec) / 1e3;

    emit_enabled = 1;
    seed_quantum_rng(effective_seed);
    reg = init_register((uint8_t)qubits);

    printf("{\"ev\":\"meta\",\"qubits\":%d,\"dim\":%d,\"max_qubits\":%d,\"mode\":\"%s\"",
           reg.num_qubits, reg.dim, MAX_QUBITS, trace_steps ? "step" : "gate");
    emit_state(&reg);
    printf("}\n");

    /* Pass 2 of 2: the traced run. (Pass 1 happened above with emission off,
     * which is where the compute timing comes from.) */
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    run_ops(&reg);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double trace_us = (t1.tv_sec - t0.tv_sec) * 1e6 + (t1.tv_nsec - t0.tv_nsec) / 1e3;

    /* Amplitude-buffer footprint. Deliberately NOT sizeof(quantum_register_t):
     * that depends on the host pointer width (8 on x86-64, 4 on wasm32, 2 on
     * AVR), so it would report a different number in every build. The amplitude
     * pool is two int16_t per state everywhere, which is the figure that
     * actually constrains how many qubits fit in the ATmega's 2 KB. */
    printf("{\"ev\":\"done\",\"ops\":%d,\"gates\":%d,\"events\":%ld,"
           "\"compute_us\":%.2f,\"trace_us\":%.2f,"
           "\"state_bytes\":%u,\"pool_bytes\":%u}\n",
           op_count, gate_calls, event_count, compute_us, trace_us,
           (unsigned)(sizeof(complex_q14_t) * reg.dim),
           (unsigned)(sizeof(complex_q14_t) * 64));
    fflush(stdout);
    return 0;
}

#ifndef __EMSCRIPTEN__
int main(void) {
    static char program[64 * 1024];
    size_t n = fread(program, 1, sizeof program - 1, stdin);
    program[n] = '\0';

    setvbuf(stdout, NULL, _IOFBF, 1 << 16);
    return qt_run(program);
}
#endif
