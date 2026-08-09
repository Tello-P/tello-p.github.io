#ifndef FIXED_POINT_H
#define FIXED_POINT_H

#include <stdint.h>

#define Q14_ONE       16384
#define Q14_HALF      8192
#define Q14_INV_SQRT2 11585

/* 1/sqrt(2) again, but with 16 fractional bits instead of 14.
 *
 * 11585 is the closest Q1.14 can get to 16384/sqrt(2) = 11585.2375, and that
 * 0.2375 shortfall makes H a contraction rather than a rotation: it costs
 * 1 - 2*(11585/16384)^2 = 4.1e-5 of the norm on every single application, in
 * the same direction every time. Deep circuits are mostly Hadamards, so the
 * loss compounds — 52 H gates of a 4-qubit Grover run brought the norm to
 * 0.9979 with nothing else to blame.
 *
 * The gate multiplies into an int32 anyway, so the extra two bits are free
 * here. 16 is as far as the accumulator can go: |a +- b| <= 16384*sqrt(2) =
 * 23170 for a normalised pair, and 23170 * 46341 = 1.07e9 still leaves half
 * of int32 spare, where Q1.17 would sit on the overflow boundary.
 */
#define Q16_INV_SQRT2 46341L
#define Q16_HALF      32768L

typedef struct {
    int16_t real;
    int16_t imag;
} complex_q14_t;

int16_t fp_mul(int16_t a, int16_t b);
uint32_t fp_isqrt(uint32_t x);
complex_q14_t complex_add(complex_q14_t a, complex_q14_t b);
complex_q14_t complex_mul(complex_q14_t a, complex_q14_t b);
int16_t complex_mag_sq(complex_q14_t a);

#endif
