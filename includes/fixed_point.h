#ifndef FIXED_POINT_H
#define FIXED_POINT_H

#include <stdint.h>

#define Q14_ONE       16384
#define Q14_HALF      8192
#define Q14_INV_SQRT2 11585

typedef struct {
    int16_t real;
    int16_t imag;
} complex_q14_t;

int16_t fp_mul(int16_t a, int16_t b);
complex_q14_t complex_add(complex_q14_t a, complex_q14_t b);
complex_q14_t complex_mul(complex_q14_t a, complex_q14_t b);
int16_t complex_mag_sq(complex_q14_t a);

#endif
