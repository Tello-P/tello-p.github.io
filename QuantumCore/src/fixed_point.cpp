#include "fixed_point.h"

int16_t fp_mul(int16_t a, int16_t b) {
#ifdef __AVR__
    int16_t result;
    /* (x >> 14) is equivalent to (x << 2) >> 16.
     * In AVR, shifting by 16 is free and we can 
     * speed it more
     */
    asm volatile (
        "muls  %B1, %B2      \n\t"
        "movw  %A0, r0       \n\t" 
        "mul   %A1, %A2      \n\t"
        "movw  r18, r0       \n\t"
        "mulsu %B1, %A2      \n\t"
        "add   r19, r0       \n\t"
        "adc   %A0, r1       \n\t"
        "adc   %B0, __zero_reg__ \n\t"
        "mulsu %B2, %A1      \n\t"
        "add   r19, r0       \n\t"
        "adc   %A0, r1       \n\t"
        "adc   %B0, __zero_reg__ \n\t"
        // Apply rounding (+8192) and shift >> 14
        "lsl   r19           \n\t" 
        "rol   %A0           \n\t"
        "rol   %B0           \n\t"
        "lsl   r19           \n\t"
        "rol   %A0           \n\t"
        "rol   %B0           \n\t"
        "clr   __zero_reg__  \n\t"
        : "=&r" (result)
        : "a" (a), "a" (b)
        : "r0", "r1", "r18", "r19"
    );
    return result;
#else
    //PC testing
    int32_t res = (int32_t)a * (int32_t)b;
    return (int16_t)((res + 8192) >> 14);
#endif
}


complex_q14_t complex_add(complex_q14_t a, complex_q14_t b) {
    return (complex_q14_t){a.real + b.real, a.imag + b.imag};
}

complex_q14_t complex_mul(complex_q14_t a, complex_q14_t b) {
    complex_q14_t res;
    res.real = fp_mul(a.real, b.real) - fp_mul(a.imag, b.imag);
    res.imag = fp_mul(a.real, b.imag) + fp_mul(a.imag, b.real);
    return res;
}

int16_t complex_mag_sq(complex_q14_t a) {
    int32_t r2 = (int32_t)a.real * a.real;
    int32_t i2 = (int32_t)a.imag * a.imag;
    return (int16_t)((r2 + i2) >> 14);
}
