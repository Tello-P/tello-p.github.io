#include <stdio.h>
#include "quantum_core.h"
#include "quantum_register.h"

void visualize(quantum_register_t *reg) {
    for (uint16_t i = 0; i < reg->dim; i++) {
        int32_t prob = complex_mag_sq(reg->state[i]);
        int width = (prob * 30) / 16384;
        printf("|%d%d> | ", (i>>1)&1, i&1);
        for (int j = 0; j < width; j++) printf("#");
        printf(" (%d%%)\n", (prob * 100) / 16384);
    }
    printf("--------------------------------\n");
}

int main() {
    quantum_register_t reg = init_register(2);
    uint16_t target = 3; // We are looking for |11>

    printf("\n[1] Initial State (Equal Superposition)\n");
    apply_gate_h(&reg, 0);
    apply_gate_h(&reg, 1);
    visualize(&reg);

    printf("\n[2] Applying Oracle (Marking |11>)\n");
    apply_oracle(&reg, target);
    visualize(&reg);

    printf("\n[3] Applying Diffuser (Amplitude Amplification)\n");
    apply_diffuser(&reg);
    visualize(&reg);

    return 0;
}
