#include <stdio.h>
#include "quantum_core.h"
#include "quantum_register.h"

void print_register(quantum_register_t *reg) {
  for (uint16_t i = 0; i < reg->dim; i++) {
    if (reg->state[i].real != 0 || reg->state[i].imag != 0) {
      printf("|%d%d>: %d + %di\n", (i >> 1) & 1, i & 1, reg->state[i].real, reg->state[i].imag);
    }
  }
}

int main() {
  quantum_register_t reg = init_register(2);

  printf("Creating Bell State...\n");
  apply_gate_h(&reg, 0);
  apply_gate_cnot(&reg, 0, 1);
  print_register(&reg);

  printf("\nMeasuring Qubit 0...\n");
  int m = measure_qubit(&reg, 0);
  printf("Result: %d\n", m);

  printf("\nState after collapse:\n");
  print_register(&reg);

  return 0;
}
