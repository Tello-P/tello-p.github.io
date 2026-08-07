#include <stdio.h>
#include <time.h>
#include "quantum_core.h"
#include "quantum_register.h"

void visualize_register(quantum_register_t *reg) {
  printf("\n--- Quantum State Visualization ---\n");
  printf("State | Probability | Graphic\n");
  printf("------------------------------------\n");
  for (uint16_t i = 0; i < reg->dim; i++) {
    int32_t prob_q14 = complex_mag_sq(reg->state[i]);

    int bar_width = (prob_q14 * 20) / 16384;

    printf("|%c%c%c> | %3d%%       | ", 
           (i & 4) ? '1' : '0', 
           (i & 2) ? '1' : '0', 
           (i & 1) ? '1' : '0',
           (prob_q14 * 100) / 16384);

    for (int j = 0; j < bar_width; j++) printf("#");
    printf("\n");
  }
  printf("------------------------------------\n");
}

int main() {
  seed_quantum_rng((uint64_t)time(NULL));
  quantum_register_t reg = init_register(3);

  printf("\n[Step 1] Preparing Message on Q0...\n");
  apply_gate_x(&reg, 0);
  apply_gate_h(&reg, 0);
  visualize_register(&reg);

  printf("\n[Step 2] Creating Entanglement Bridge (Q1-Q2)...\n");
  apply_gate_h(&reg, 1);
  apply_gate_cnot(&reg, 1, 2);
  visualize_register(&reg);

  printf("\n[Step 3] Performing Teleportation Protocol...\n");
  apply_gate_cnot(&reg, 0, 1);
  apply_gate_h(&reg, 0);

  int m1 = measure_qubit(&reg, 1);
  int m0 = measure_qubit(&reg, 0);
  printf(">> Alice measured: Q0=%d, Q1=%d\n", m0, m1);

  printf("\n[Step 4] Bob applies corrections to Q2...\n");
  if (m1 == 1) apply_gate_x(&reg, 2);
  if (m0 == 1) apply_gate_z(&reg, 2);
  visualize_register(&reg);

  printf("\n[Step 5] Verification (Rotate Q2 back to |0>)...\n");
  apply_gate_h(&reg, 2);
  apply_gate_x(&reg, 2);
  visualize_register(&reg);

  int final_val = measure_qubit(&reg, 2);
  if (final_val == 0) {
    printf("\nRESULT: \033[1;32mTELEPORTATION SUCCESSFUL\033[0m\n\n");
  } else {
    printf("\nRESULT: \033[1;31mTELEPORTATION FAILED\033[0m\n\n");
  }

  return 0;
}
