#ifndef QUANTUM_CORE_H
#define QUANTUM_CORE_H
#include "quantum_register.h"
#include "fixed_point.h"
#include <stdint.h>

extern uint64_t rng_state;


typedef struct {
     complex_q14_t alpha;
     complex_q14_t beta;
} qubit_t;


void apply_oracle(quantum_register_t *reg, uint16_t target_index);
void apply_diffuser(quantum_register_t *reg);//ONLY 2 QUBITS POSSIBLE

void apply_gate_x(quantum_register_t *reg, uint8_t target);
void apply_gate_h(quantum_register_t *reg, uint8_t target);
void apply_gate_cnot(quantum_register_t *reg, uint8_t control, uint8_t target);
void apply_gate_z(quantum_register_t *reg, uint8_t target);

int measure(qubit_t *q);
int measure_qubit(quantum_register_t *reg, uint8_t target);
int16_t random_q14(void);
void seed_quantum_rng(uint64_t seed);

#endif

