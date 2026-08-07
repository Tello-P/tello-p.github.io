#include <stdio.h>
#include <stdint.h>
#include "quantum_register.h"
#include "fixed_point.h"
#include "quantum_core.h"

void print_complex_q14(const complex_q14_t *c) {
    float re = (float)c->real / 16384.0f;
    float im = (float)c->imag / 16384.0f;

    if (c->real == Q14_ONE && c->imag == 0) {
        printf(" 1.000 + 0.000j");
    } else if (c->real == 0 && c->imag == 0) {
        printf(" 0.000 + 0.000j");
    } else {
        printf("%+6.3f %+6.3fi", re, im);
    }
}

void print_register(const quantum_register_t *reg) {
    if (reg->dim == 0 || reg->state == NULL) {
        printf("Register is invalid or exceeds static bounds\n");
        return;
    }

    printf("Register: %d qubits, %u basis states\n", reg->num_qubits, reg->dim);
    printf("--------------------------------------------------\n");

    for (uint16_t i = 0; i < reg->dim; i++) {
        printf("|");
        for (int b = reg->num_qubits - 1; b >= 0; b--) {
            putchar((i & (1u << b)) ? '1' : '0');
        }
        printf("⟩  ");

        print_complex_q14(&reg->state[i]);

        int16_t mag2 = complex_mag_sq(reg->state[i]);
        printf("    |amp|^2 = %5d / 16384\n", mag2);
    }
    printf("\n");
}

int main(void) {
    
    printf("=== Single qubit test ===\n");
    quantum_register_t r1 = init_register(1);
    print_register(&r1);

    printf("=== Two qubit test ===\n");
    quantum_register_t r2 = init_register(2);
    print_register(&r2);

    printf("=== Three qubit test ===\n");
    quantum_register_t r3 = init_register(3);
    print_register(&r3);

    printf("=== Invalid cases (Should fail gracefully) ===\n");
    quantum_register_t bad = init_register(0);
    print_register(&bad);

    bad = init_register(10);
    print_register(&bad);

    return 0;
}
