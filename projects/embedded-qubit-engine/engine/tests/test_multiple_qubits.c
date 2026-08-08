#include <stdio.h>
#include "quantum_register.h"
#include "quantum_core.h"

void apply_gate_to_reg(quantum_register_t *reg, uint8_t target, void (*gate)(qubit_t*)) {
    uint16_t stride = 1 << target;
    for (uint16_t i = 0; i < reg->dim; i++) {
        if (!(i & stride)) {
            qubit_t q = {reg->state[i], reg->state[i | stride]};
            gate(&q);
            reg->state[i] = q.alpha;
            reg->state[i | stride] = q.beta;
        }
    }
}

void print_bell_state(quantum_register_t *reg) {
    printf("Estado del Registro:\n");
    for (uint16_t i = 0; i < reg->dim; i++) {
        int p = (complex_mag_sq(reg->state[i]) * 100) / Q14_ONE;
        if (p > 0) {
            printf("  |%d%d⟩: Prob %d%%\n", (i >> 1) & 1, i & 1, p);
        }
    }
}

int main() {
    printf("=== Generando Estado de Bell |\u03A6+> ===\n");
    quantum_register_t reg = init_register(2);

    printf("1. Aplicando Hadamard al Qubit 0...\n");
    apply_gate_to_reg(&reg, 0, apply_gate_h);

    printf("2. Aplicando CNOT (Control: 0, Target: 1)...\n");
    apply_gate_cnot(&reg, 0, 1);

    print_bell_state(&reg);

    printf("\nResultado esperado: 50%% en |00> y 50%% en |11>\n");
    return 0;
}
