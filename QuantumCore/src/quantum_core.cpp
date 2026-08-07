#include "quantum_core.h"


void seed_quantum_rng(uint64_t seed) {
    if (seed == 0) seed = 0x853c49e6748fea9bULL;
    rng_state = seed;
}

uint64_t rng_state = 0x853c49e6748fea9bULL;//Initial seed for random

// xorshift* 64-bit for random
static inline uint64_t rotl(const uint64_t x, int k) {
  return (x << k) | (x >> (64 - k));
}
static uint64_t next_random_u64(void) {
  uint64_t z = (rng_state += 0x9e3779b97f4a7c15ULL);
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}
#define Q14_MAX 16384
int16_t random_q14(void) {
  uint64_t r = next_random_u64();
  uint32_t val = ((uint32_t)(r >> 48) * (uint32_t)Q14_MAX) >> 16;
  return (int16_t) val;
}

void apply_oracle(quantum_register_t *reg, uint16_t target_index) {
  reg->state[target_index].real = -reg->state[target_index].real;
  reg->state[target_index].imag = -reg->state[target_index].imag;
}

// so multiple qubits can be diffused
void apply_multi_controlled_z(quantum_register_t *reg) {
  uint16_t last_index = reg->dim - 1;
  reg->state[last_index].real = -reg->state[last_index].real;
  reg->state[last_index].imag = -reg->state[last_index].imag;
}

void apply_diffuser(quantum_register_t *reg) {
  for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_h(reg, i);
  for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_x(reg, i);

  apply_multi_controlled_z(reg);
  
  for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_x(reg, i);
  for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_h(reg, i);
}

void apply_gate_x(quantum_register_t *reg, uint8_t target) {
  uint16_t mask = (1u << target);

  for (uint16_t i = 0; i < reg->dim; i++) {
    if (!(i & mask)) {
      uint16_t i0 = i;
      uint16_t i1 = i | mask;

      complex_q14_t temp = reg->state[i0];
      reg->state[i0] = reg->state[i1];
      reg->state[i1] = temp;
    }
  }
}

void apply_gate_h(quantum_register_t *reg, uint8_t target) {
  uint16_t mask = (1u << target);
  const int16_t s = Q14_INV_SQRT2;

  for (uint16_t i = 0; i < reg->dim; i++) {
    if (!(i & mask)) {
      uint16_t i0 = i;
      uint16_t i1 = i | mask;

      int32_t ar = reg->state[i0].real;
      int32_t ai = reg->state[i0].imag;
      int32_t br = reg->state[i1].real;
      int32_t bi = reg->state[i1].imag;

      reg->state[i0].real = (int16_t)(((ar + br) * s + Q14_HALF) >> 14);
      reg->state[i0].imag = (int16_t)(((ai + bi) * s + Q14_HALF) >> 14);

      reg->state[i1].real = (int16_t)(((ar - br) * s + Q14_HALF) >> 14);
      reg->state[i1].imag = (int16_t)(((ai - bi) * s + Q14_HALF) >> 14);
    }
  }
}

void apply_gate_cnot(quantum_register_t *reg, uint8_t control, uint8_t target) {
  uint16_t control_mask = (1u << control);
  uint16_t target_mask = (1u << target);

  for (uint16_t i = 0; i < reg->dim; i++) {
    if ((i & control_mask) && !(i & target_mask)) {
      uint16_t i0 = i;
      uint16_t i1 = i | target_mask;

      complex_q14_t temp = reg->state[i0];
      reg->state[i0] = reg->state[i1];
      reg->state[i1] = temp;
    }
  }
}

void apply_gate_z(quantum_register_t *reg, uint8_t target) {
    uint16_t mask = (1u << target);
    for (uint16_t i = 0; i < reg->dim; i++) {
        if (i & mask) {
            reg->state[i].real = -reg->state[i].real;
            reg->state[i].imag = -reg->state[i].imag;
        }
    }
}

int measure(qubit_t *q){
  int16_t alpha_sq = complex_mag_sq(q->alpha);
  int16_t random = random_q14();

  if(random<alpha_sq){
    q->alpha.real = Q14_ONE;
    q->alpha.imag = 0;
    q->beta.real  = 0;
    q->beta.imag  = 0;
    return 0;
  }else{
    q->alpha.real = 0;
    q->alpha.imag = 0;
    q->beta.real  = Q14_ONE;
    q->beta.imag  = 0;
    return 1;
  }
}


int measure_qubit(quantum_register_t *reg, uint8_t target) {
  uint16_t mask = (1u << target);
  int32_t prob1_q14 = 0;

  for (uint16_t i = 0; i < reg->dim; i++) {
    if (i & mask) {
      prob1_q14 += complex_mag_sq(reg->state[i]);
    }
  }

  int16_t r = random_q14();
  int result = (r < (int16_t)prob1_q14) ? 1 : 0;

  int32_t sum_sq = 0;
  for (uint16_t i = 0; i < reg->dim; i++) {
    int bit = (i & mask) ? 1 : 0;
    if (bit != result) {
      reg->state[i].real = 0;
      reg->state[i].imag = 0;
    } else {
      sum_sq += complex_mag_sq(reg->state[i]);
    }
  }

  if (sum_sq > 0) {
    for (uint16_t i = 0; i < reg->dim; i++) {
      if (reg->state[i].real != 0 || reg->state[i].imag != 0) {
        int32_t r_ext = (int32_t)reg->state[i].real << 14;
        int32_t i_ext = (int32_t)reg->state[i].imag << 14;
        int16_t root_sum = 11585; // Simplification
        // 1/sqrt(sum_sq) is needed if i have != 90º logic gates
        reg->state[i].real = (int16_t)(r_ext / root_sum);
        reg->state[i].imag = (int16_t)(i_ext / root_sum);
      }
    }
  }

  return result;
}
