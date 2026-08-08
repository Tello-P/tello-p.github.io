#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "quantum_core.h"
#include "fixed_point.h"

#define ABS_DIFF(a,b)   ((int32_t)(a) - (int32_t)(b) >= 0 ? (a)-(b) : (b)-(a))
#define TOL_Q14         220
#define TRIALS_REPRO    20
#define STAT_TRIALS     10000

extern uint64_t rng_state;

static void print_qubit(const char* label, const qubit_t* q)
{
    printf("%-14s α = %6d + %6di    β = %6d + %6di\n",
           label,
           q->alpha.real, q->alpha.imag,
           q->beta.real,  q->beta.imag);
}

static int32_t mag_sq_sum(const qubit_t* q)
{
    return (int32_t)complex_mag_sq(q->alpha) +
           (int32_t)complex_mag_sq(q->beta);
}

void test_normalization_hadamard(void)
{
    printf("\n=== Normalization after Hadamard ===\n");

    qubit_t q;

    q.alpha.real = Q14_ONE;
    q.alpha.imag = 0;
    q.beta.real  = 0;
    q.beta.imag  = 0;

    apply_gate_h(&q);

    int32_t total = mag_sq_sum(&q);

    print_qubit("After H |0>", &q);

    printf("Sum |α|² + |β|² = %d (expected ≈ %d ± %d)\n",
           total, Q14_ONE, TOL_Q14);

    printf("OK? %s\n",
           (total >= Q14_ONE - TOL_Q14 &&
            total <= Q14_ONE + TOL_Q14) ?
           "yes" : "normalization drift");

    q.alpha.real = 0;
    q.alpha.imag = 0;
    q.beta.real  = Q14_ONE;
    q.beta.imag  = 0;

    apply_gate_h(&q);

    total = mag_sq_sum(&q);

    print_qubit("After H |1>", &q);

    printf("Sum |α|² + |β|² = %d (expected ≈ %d ± %d)\n",
           total, Q14_ONE, TOL_Q14);
}

void test_hadamard_on_one(void)
{
    printf("\n=== Hadamard on |1> ===\n");

    qubit_t q;

    q.alpha.real = 0;
    q.alpha.imag = 0;

    q.beta.real = Q14_ONE;
    q.beta.imag = 0;

    apply_gate_h(&q);

    int diff_alpha = ABS_DIFF(q.alpha.real,  Q14_INV_SQRT2);
    int diff_beta  = ABS_DIFF(q.beta.real,  -Q14_INV_SQRT2);

    print_qubit("H|1>", &q);

    printf("diff α=%d  β=%d  (tol=%d)\n",
           diff_alpha, diff_beta, TOL_Q14);

    printf("OK? %s\n",
           (diff_alpha < TOL_Q14 &&
            diff_beta  < TOL_Q14) ?
           "yes" : "phase/sign error");
}

void test_measure_deterministic(void)
{
    printf("\n=== Deterministic measurement ===\n");

    qubit_t q0 = {{Q14_ONE,0},{0,0}};
    qubit_t q1 = {{0,0},{Q14_ONE,0}};

    rng_state = 0x1122334455667788ULL;

    printf("|0> → %d (expected 0)\n", measure(&q0));
    printf("|1> → %d (expected 1)\n", measure(&q1));

    rng_state = 0x1122334455667788ULL;

    printf("repeat |0> → %d\n", measure(&q0));
}

void test_reproducibility(void)
{
    printf("\n=== RNG reproducibility ===\n");

    qubit_t base =
    {
        {Q14_INV_SQRT2,0},
        {Q14_INV_SQRT2,0}
    };

    uint64_t seed = 0xAABBCCDD11223344ULL;

    int r1[TRIALS_REPRO];
    int r2[TRIALS_REPRO];

    rng_state = seed;

    for(int i=0;i<TRIALS_REPRO;i++)
    {
        qubit_t q = base;
        r1[i] = measure(&q);
    }

    rng_state = seed;

    for(int i=0;i<TRIALS_REPRO;i++)
    {
        qubit_t q = base;
        r2[i] = measure(&q);
    }

    int equal = 1;

    for(int i=0;i<TRIALS_REPRO;i++)
        if(r1[i]!=r2[i])
            equal = 0;

    printf("Sequences equal? %s\n",
           equal ? "YES" : "NO");
}

void test_measure_statistics(void)
{
    printf("\n=== Measurement statistics ===\n");

    qubit_t q =
    {
        {Q14_INV_SQRT2,0},
        {Q14_INV_SQRT2,0}
    };

    int count0 = 0;

    for(int i=0;i<STAT_TRIALS;i++)
    {
        qubit_t copy = q;

        if(measure(&copy)==0)
            count0++;
    }

    float p = (float)count0 / STAT_TRIALS;

    printf("P(|0>) ≈ %.3f  (expected ≈ 0.5)\n",p);
}

void test_interference_identity(void)
{
    printf("\n=== Interference test H·H = I (IBM style) ===\n");

    qubit_t q =
    {
        {Q14_ONE,0},
        {0,0}
    };

    apply_gate_h(&q);
    apply_gate_h(&q);

    print_qubit("H(H|0>)", &q);

    int diff = ABS_DIFF(q.alpha.real, Q14_ONE);

    printf("Return to |0>? diff=%d  tol=%d\n",
           diff, TOL_Q14);
}

void test_measure_collapse(void)
{
    printf("\n=== State collapse after measurement ===\n");

    qubit_t q =
    {
        {Q14_INV_SQRT2,0},
        {Q14_INV_SQRT2,0}
    };

    int r = measure(&q);

    print_qubit("Collapsed state", &q);

    printf("Result = %d\n", r);

    int deterministic = measure(&q);

    printf("Second measurement = %d (must match)\n",
           deterministic);
}

void test_negative_phase(void)
{
    printf("\n=== Negative imaginary phase stability ===\n");

    qubit_t q;

    q.alpha.real = 8192;
    q.alpha.imag = -8192;

    q.beta.real  = 8192;
    q.beta.imag  = 8192;

    int32_t before = mag_sq_sum(&q);

    apply_gate_h(&q);

    int32_t after = mag_sq_sum(&q);

    printf("before=%d after=%d\n",before,after);

    printf("norm preserved? %s\n",
           ABS_DIFF(before,after)<400 ?
           "yes" : "numerical drift");
}

#define DRIFT_STEPS 1000

void test_hadamard_drift(void)
{
    printf("\n=== Hadamard numerical drift test ===\n");

    qubit_t q =
    {
        {Q14_ONE,0},
        {0,0}
    };

    for(int i=0;i<DRIFT_STEPS;i++)
    {
        apply_gate_h(&q);
    }

    print_qubit("After many H", &q);

    int diff_alpha = ABS_DIFF(q.alpha.real, Q14_ONE);
    int diff_beta  = ABS_DIFF(q.beta.real, 0);

    printf("Drift α=%d  β=%d  (tol=%d)\n",
           diff_alpha, diff_beta, TOL_Q14);

    printf("Stable? %s\n",
           (diff_alpha < TOL_Q14 &&
            diff_beta  < TOL_Q14) ?
           "YES" : "NUMERICAL DRIFT");
}


int main(void)
{
    printf("=== Q1.14 Quantum Core Validation Suite ===\n");

    test_normalization_hadamard();
    test_hadamard_on_one();
    test_measure_deterministic();
    test_reproducibility();
    test_measure_statistics();
    test_interference_identity();
    test_measure_collapse();
    test_negative_phase();
    test_hadamard_drift();
    printf("\n--- End tests ---\n");

    return 0;
}
