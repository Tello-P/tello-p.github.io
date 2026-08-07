#ifndef QUANTUM_REGISTER_H
#define QUANTUM_REGISTER_H

#include "fixed_point.h"
#include <stdint.h>

#define MAX_QUBITS 4
#define MAX_STATES (1 << MAX_QUBITS)

typedef struct {
    uint8_t num_qubits;
    uint16_t dim;                  // remove this!!!!!!!!!!!!!!!!!!!
    complex_q14_t *state;
} quantum_register_t;

quantum_register_t init_register(uint8_t num_qubits);

complex_q14_t make_zero_state(void);

complex_q14_t make_one_state(void);

#endif
