#include "quantum_register.h"

#define STATIC_MAX_STATES 64
static complex_q14_t static_state[STATIC_MAX_STATES];


complex_q14_t make_zero_state(void) {
  return (complex_q14_t){Q14_ONE, 0};
}

complex_q14_t make_one_state(void) {
  return (complex_q14_t){0, 0};
}

quantum_register_t init_register(uint8_t n) {
  quantum_register_t reg = {0};
  if (n == 0 || n > MAX_QUBITS || (1u << n) > STATIC_MAX_STATES) return reg;

  reg.num_qubits = n;
  reg.dim = (uint16_t)(1u << n);
  reg.state = static_state;

  reg.state[0] = make_zero_state();
  for (uint16_t i = 1; i < reg.dim; i++) {
    reg.state[i] = make_one_state();
  }
  return reg;
}

