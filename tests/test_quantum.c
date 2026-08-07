#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include "fixed_point.h"
#include "quantum_core.h"

void test_gate_x() {
  printf("Test X Gate (NOT): ");
  qubit_t q = {{Q14_ONE, 0}, {0, 0}}; // |0> state
  apply_gate_x(&q);

  // Now it should be |1> (alpha=0, beta=1)
  if (q.alpha.real == 0 && q.beta.real == Q14_ONE) {
    printf("PASSED\n");
  } else {
    printf("FAILED (Alpha: %d, Beta: %d)\n", q.alpha.real, q.beta.real);
  }
}

void test_gate_h_superposition() {
  printf("Test H Gate (Superposition): ");
  qubit_t q = {{Q14_ONE, 0}, {0, 0}}; // |0> state
  apply_gate_h(&q);

  // After H, alpha and beta should be ~0.7071 (11585)
  bool a_ok = (q.alpha.real >= 11584 && q.alpha.real <= 11586);
  bool b_ok = (q.beta.real >= 11584 && q.beta.real <= 11586);

  if (a_ok && b_ok) {
    printf("PASSED\n");
  } else {
    printf("FAILED (Alpha: %d, Beta: %d)\n", q.alpha.real, q.beta.real);
  }
}

void test_measurement_statistics() {
  printf("Statistical Test (1000 measurements in superposition):\n");
  int zeros = 0;
  int ones = 0;
  int total = 1000;
  for (int i = 0; i < total; i++) {
    qubit_t q = {{Q14_ONE, 0}, {0, 0}};
    apply_gate_h(&q); // Put in 50/50 superposition
    if (measure(&q) == 0) zeros++;
    else ones++;
  }
  printf(" Result -> 0: %d, 1: %d\n", zeros, ones);

  // A 10% error margin is acceptable for 1000 samples
  if (zeros > 400 && zeros < 600) {
    printf(" STATISTICAL: PASSED\n");
  } else {
    printf(" STATISTICAL: FAILED (OUT OF RANGE)\n");
  }
}

int main() {
  printf("=== STARTING TESTS FOR QUANTUM_CORE ===\n");
  test_gate_x();
  test_gate_h_superposition();
  test_measurement_statistics();
  printf("=========================================\n");
  return 0;
}
