#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quantum_register.h"
#include "quantum_core.h"

void show_progress(const quantum_register_t *reg, const char *step) {
    printf("\n--- %s ---\n", step);
    for (uint16_t i = 0; i < reg->dim; i++) {
        int prob = (complex_mag_sq(reg->state[i]) * 100) / Q14_ONE;
        printf("[%d] |%d%d%d> : ", i, (i>>2)&1, (i>>1)&1, i&1);
        for (int j = 0; j < prob / 2; j++) printf("#");
        printf(" %d%%\n", prob);
    }
}

void oracle_mark_target(quantum_register_t *reg, uint16_t target) {
    reg->state[target].real = -reg->state[target].real;
    reg->state[target].imag = -reg->state[target].imag;
}

void apply_diffuser(quantum_register_t *reg) {
    int32_t sum_re = 0;
    for (int i = 0; i < reg->dim; i++) sum_re += reg->state[i].real;
    int16_t mean_re = (int16_t)(sum_re / reg->dim);

    for (int i = 0; i < reg->dim; i++) {
        reg->state[i].real = 2 * mean_re - reg->state[i].real;
    }
}

int perform_measurement(quantum_register_t *reg) {
    int16_t r = random_q14(); // Value between 0 and 16384
    int32_t cumulative = 0;

    for (uint16_t i = 0; i < reg->dim; i++) {
        cumulative += complex_mag_sq(reg->state[i]);
        if (r <= cumulative) return i;
    }
    return reg->dim - 1;
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        printf("Usage: %s <number 1-8>\n", argv[0]);
        return 1;
    }

    int input = atoi(argv[1]);
    if (input < 1 || input > 8) {
        printf("Error: Please enter a number between 1 and 8.\n");
        return 1;
    }

    uint16_t target_index = (uint16_t)(input - 1);
    printf("=== QUANTUM SEARCH: FINDING NUMBER %d (Index %d) ===\n", input, target_index);

    quantum_register_t reg = init_register(3);

    int16_t initial_amp = 5792; 
    for (int i = 0; i < reg.dim; i++) reg.state[i].real = initial_amp;
    
    show_progress(&reg, "Initial Superposition");

    for (int iter = 1; iter <= 2; iter++) {
        oracle_mark_target(&reg, target_index);
        apply_diffuser(&reg);
        char buffer[64];
        sprintf(buffer, "After Iteration %d", iter);
        show_progress(&reg, buffer);
    }

    int measured = perform_measurement(&reg);
    printf("\n[QUANTUM MEASUREMENT RESULT]\n");
    printf("The engine collapsed into state: |%d%d%d> (Index %d)\n", 
            (measured>>2)&1, (measured>>1)&1, measured&1, measured);
    printf("Human-readable result: %d\n", measured + 1);

    if (measured == target_index) {
        printf("SUCCESS: The quantum search found your number!\n");
    } else {
        printf("FAILURE: Probabilistic error (try again).\n");
    }

    return 0;
}
