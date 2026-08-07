#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include "fixed_point.h"

#define ANSI_COLOR_RED     "\x1b[31m"
#define ANSI_COLOR_GREEN   "\x1b[32m"
#define ANSI_COLOR_RESET   "\x1b[0m"

void print_test_result(const char* test_name, bool passed) {
    if (passed) {
        printf("%s: " ANSI_COLOR_GREEN "PASSED" ANSI_COLOR_RESET "\n", test_name);
    } else {
        printf("%s: " ANSI_COLOR_RED "FAILED" ANSI_COLOR_RESET "\n", test_name);
    }
}

void test_fp_mul() {
    int16_t a = 8192;
    int16_t b = 8192;
    int16_t res = fp_mul(a, b);
    print_test_result("Multiplicacion Simple (0.5 * 0.5)", res == 4096);

    res = fp_mul(Q14_INV_SQRT2, Q14_INV_SQRT2);
    print_test_result("Precision Hadamard (1/sqrt2^2)", res >= 8191 && res <= 8193);
}

void test_complex_math() {
    complex_q14_t c1 = {Q14_ONE, 0};
    complex_q14_t c2 = {0, Q14_ONE};
    complex_q14_t res = complex_mul(c1, c2);
    
    print_test_result("Multiplicacion Compleja (Rotacion i)", (res.real == 0 && res.imag == Q14_ONE));

    complex_q14_t h = {Q14_INV_SQRT2, Q14_INV_SQRT2};
    int16_t mag_sq = complex_mag_sq(h);
    print_test_result("Módulo al cuadrado (Normalización)", mag_sq >= 16383 && mag_sq <= 16385);
}

int main() {
    printf("\n=== AVR-QUANTUM-CORE: SUITE DE PRUEBAS FASE 1 ===\n\n");
    
    test_fp_mul();
    test_complex_math();
    
    printf("\n================================================\n");
    return 0;
}
