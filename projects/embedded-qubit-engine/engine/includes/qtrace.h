#ifndef QTRACE_H
#define QTRACE_H

/* Optional execution-trace hooks used by the web debugger (web/).
 *
 * Unless QTRACE is defined at compile time every macro below expands to a
 * no-op, so the desktop Makefile and the AVR firmware build byte-identical
 * code. Only web/engine/qtrace.c defines QTRACE and provides the callbacks.
 */

#ifdef QTRACE

#include <stdint.h>

struct quantum_register;

void qt_gate_begin(const void *reg, const char *op, int a, int b, int line);
void qt_gate_end(const void *reg);
void qt_step(const void *reg, int line, int i0, int i1);
void qt_note(const void *reg, int line, const char *what, int value);

/* QT_STEP reports __LINE__ + 1: by convention it sits immediately above the
 * statement it announces, so the debugger highlights the real work, not the
 * instrumentation line. Keep that placement when adding new call sites.
 */
#define QT_GATE_BEGIN(reg, op, a, b) qt_gate_begin((reg), (op), (a), (b), __LINE__)
#define QT_GATE_END(reg)             qt_gate_end((reg))
#define QT_STEP(reg, i0, i1)         qt_step((reg), __LINE__ + 1, (int)(i0), (int)(i1))
#define QT_NOTE(reg, what, value)    qt_note((reg), __LINE__, (what), (int)(value))

#else

#define QT_GATE_BEGIN(reg, op, a, b) ((void)0)
#define QT_GATE_END(reg)             ((void)0)
#define QT_STEP(reg, i0, i1)         ((void)0)
#define QT_NOTE(reg, what, value)    ((void)0)

#endif

#endif
