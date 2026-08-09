#include "quantum_core.h"
#include "qtrace.h"


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
  QT_GATE_BEGIN(reg, "ORACLE", target_index, -1);
  QT_STEP(reg, target_index, target_index);
  reg->state[target_index].real = -reg->state[target_index].real;
  reg->state[target_index].imag = -reg->state[target_index].imag;
  QT_GATE_END(reg);
}

void apply_diffuser(quantum_register_t *reg) {
    for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_h(reg, i);
    for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_x(reg, i);

    // ONLY FOR 2 QUBITS, MIGHT CHANGE THIS !!!!!!!!!!!!!!!!!!!!!!!!!!
    QT_GATE_BEGIN(reg, "PHASE_FLIP", reg->dim - 1, -1);
    QT_STEP(reg, reg->dim - 1, reg->dim - 1);
    reg->state[reg->dim - 1].real = -reg->state[reg->dim - 1].real;
    reg->state[reg->dim - 1].imag = -reg->state[reg->dim - 1].imag;
    QT_GATE_END(reg);

    for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_x(reg, i);
    for (uint8_t i = 0; i < reg->num_qubits; i++) apply_gate_h(reg, i);
}


void apply_gate_x(quantum_register_t *reg, uint8_t target) {
  uint16_t mask = (1u << target);
  QT_GATE_BEGIN(reg, "X", target, -1);

  for (uint16_t i = 0; i < reg->dim; i++) {
    if (!(i & mask)) {
      uint16_t i0 = i;
      uint16_t i1 = i | mask;

      QT_STEP(reg, i0, i1);
      complex_q14_t temp = reg->state[i0];
      reg->state[i0] = reg->state[i1];
      reg->state[i1] = temp;
    }
  }
  QT_GATE_END(reg);
}

void apply_gate_h(quantum_register_t *reg, uint8_t target) {
  uint16_t mask = (1u << target);
  const int32_t s = Q16_INV_SQRT2;   /* Q1.16: the state stays Q1.14, the scale does not */
  QT_GATE_BEGIN(reg, "H", target, -1);

  for (uint16_t i = 0; i < reg->dim; i++) {
    if (!(i & mask)) {
      uint16_t i0 = i;
      uint16_t i1 = i | mask;

      QT_STEP(reg, i0, i1);
      int32_t ar = reg->state[i0].real;
      int32_t ai = reg->state[i0].imag;
      int32_t br = reg->state[i1].real;
      int32_t bi = reg->state[i1].imag;

      reg->state[i0].real = (int16_t)(((ar + br) * s + Q16_HALF) >> 16);
      reg->state[i0].imag = (int16_t)(((ai + bi) * s + Q16_HALF) >> 16);

      reg->state[i1].real = (int16_t)(((ar - br) * s + Q16_HALF) >> 16);
      reg->state[i1].imag = (int16_t)(((ai - bi) * s + Q16_HALF) >> 16);
    }
  }
  QT_GATE_END(reg);
}

void apply_gate_cnot(quantum_register_t *reg, uint8_t control, uint8_t target) {
  uint16_t control_mask = (1u << control);
  uint16_t target_mask = (1u << target);
  QT_GATE_BEGIN(reg, "CNOT", control, target);

  for (uint16_t i = 0; i < reg->dim; i++) {
    if ((i & control_mask) && !(i & target_mask)) {
      uint16_t i0 = i;
      uint16_t i1 = i | target_mask;

      QT_STEP(reg, i0, i1);
      complex_q14_t temp = reg->state[i0];
      reg->state[i0] = reg->state[i1];
      reg->state[i1] = temp;
    }
  }
  QT_GATE_END(reg);
}

void apply_gate_z(quantum_register_t *reg, uint8_t target) {
    uint16_t mask = (1u << target);
    QT_GATE_BEGIN(reg, "Z", target, -1);
    for (uint16_t i = 0; i < reg->dim; i++) {
        if (i & mask) {
            QT_STEP(reg, i, i);
            reg->state[i].real = -reg->state[i].real;
            reg->state[i].imag = -reg->state[i].imag;
        }
    }
    QT_GATE_END(reg);
}

/* Round-to-nearest integer division, symmetric about zero: truncation here
 * would bias every renormalised amplitude towards the origin. */
static int32_t div_round(int32_t num, int32_t den) {
  return num >= 0 ? (num + den / 2) / den : (num - den / 2) / den;
}

/* An amplitude cannot leave [-1, 1] after renormalising, but rounding can
 * nudge it over the edge; Q1.14 has room to 2.0 so this only guards the type. */
static int16_t q14_sat(int32_t v) {
  if (v >  32767) return  32767;
  if (v < -32768) return -32768;
  return (int16_t)v;
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
  QT_GATE_BEGIN(reg, "MEASURE", target, -1);

  for (uint16_t i = 0; i < reg->dim; i++) {
    if (i & mask) {
      QT_STEP(reg, i, i);
      prob1_q14 += complex_mag_sq(reg->state[i]);
    }
  }
  QT_NOTE(reg, "prob1_q14", prob1_q14);

  int16_t r = random_q14();
  int result = (r < (int16_t)prob1_q14) ? 1 : 0;
  QT_NOTE(reg, "rng", r);
  QT_NOTE(reg, "result", result);

  int32_t sum_sq = 0;
  for (uint16_t i = 0; i < reg->dim; i++) {
    int bit = (i & mask) ? 1 : 0;
    QT_STEP(reg, i, i);
    if (bit != result) {
      reg->state[i].real = 0;
      reg->state[i].imag = 0;
    } else {
      sum_sq += complex_mag_sq(reg->state[i]);
    }
  }

  /* Renormalise by what actually survived the collapse.
   *
   * sum_sq is the surviving probability in Q1.14, so the divisor we need is
   * sqrt(sum_sq / Q14_ONE) expressed in Q1.14, i.e. sqrt(sum_sq * Q14_ONE).
   * This used to be the constant 11585 (= 1/sqrt(2)), which is only correct
   * when the measured outcome had probability exactly one half — measuring an
   * already-determined qubit doubled the norm instead of leaving it alone.
   * One integer square root per measurement, not per gate.
   */
  if (sum_sq > 0) {
    int32_t root = (int32_t)fp_isqrt((uint32_t)sum_sq * (uint32_t)Q14_ONE);
    if (root > 0) {
      for (uint16_t i = 0; i < reg->dim; i++) {
        if (reg->state[i].real != 0 || reg->state[i].imag != 0) {
          QT_STEP(reg, i, i);
          int32_t r_ext = (int32_t)reg->state[i].real << 14;
          int32_t i_ext = (int32_t)reg->state[i].imag << 14;
          reg->state[i].real = q14_sat(div_round(r_ext, root));
          reg->state[i].imag = q14_sat(div_round(i_ext, root));
        }
      }
    }
  }

  QT_GATE_END(reg);
  return result;
}
