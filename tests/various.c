#include <stdio.h>
#include <stdlib.h>   // Para abs()
#include "fixed_point.h"
#include "quantum_core.h" // Para qubit_t, apply_gate_h, measure

void test_fp_mul_edges() {
    struct {
        int16_t a, b, expected;
        const char* desc;
    } cases[] = {
        {Q14_ONE, Q14_ONE, Q14_ONE, "1.0 * 1.0"},
        {Q14_ONE, 0, 0, "1.0 * 0.0"},
        {Q14_HALF, Q14_HALF, 4096, "0.5 * 0.5 = 0.25 (4096)"}
    };

    printf("--- Testing Fixed Point Multiplication ---\n");
    for (size_t i = 0; i < sizeof(cases)/sizeof(cases[0]); i++) { // Usar size_t
        int16_t res = fp_mul(cases[i].a, cases[i].b);
        printf("%-25s: %s (got %d)\n", 
               cases[i].desc, 
               (res == cases[i].expected || abs(res - cases[i].expected) <= 1) ? "OK" : "FAIL",
               res);
    }
}

void test_hadamard_zero() {
    printf("\n--- Testing Hadamard on |0> ---\n");
    // Inicialización correcta de la estructura anidada
    qubit_t q = { .alpha = {Q14_ONE, 0}, .beta = {0, 0} }; 
    
    apply_gate_h(&q);

    int16_t expected = Q14_INV_SQRT2;
    int err_a = abs(q.alpha.real - expected);
    int err_b = abs(q.beta.real  - expected);

    printf("alpha = %6d + %6di  → error %d\n", q.alpha.real, q.alpha.imag, err_a);
    printf("beta  = %6d + %6di  → error %d\n", q.beta.real,  q.beta.imag,  err_b);
}

void test_measure_plus_10000() {
    printf("\n--- Testing 10,000 Measurements on |+> ---\n");
    qubit_t q = { .alpha = {Q14_INV_SQRT2, 0}, .beta = {Q14_INV_SQRT2, 0} };
    
    int count0 = 0, count1 = 0;
    rng_state = 0x123456789ABCDEF0ULL; // Ahora funciona gracias al extern

    for (int i = 0; i < 10000; i++) {
        qubit_t copy = q; 
        if (measure(&copy) == 0) count0++;
        else count1++;
    }
    printf("Results: |0>: %d, |1>: %d (Goal: ~5000/5000)\n", count0, count1);
}

int main() {
    test_fp_mul_edges();
    test_hadamard_zero();
    test_measure_plus_10000();
    return 0;
}
