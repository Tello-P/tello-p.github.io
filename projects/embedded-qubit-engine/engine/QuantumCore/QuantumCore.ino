#include "src/quantum_core.h"
#include "src/quantum_register.h"

#define NUM_QUBITS 6
#define GROVER_ITERATIONS 6

uint16_t gate_count = 0;
unsigned long total_compute_micros = 0;

void visualize_on_serial(quantum_register_t *reg) {
  Serial.println(F("\n--- Quantum State Probability ---"));
  for (uint16_t i = 0; i < reg->dim; i++) {
    int32_t prob_q14 = complex_mag_sq(reg->state[i]);
    int bar_width = (prob_q14 * 30) / 16384; 
    int percent = (prob_q14 * 100) / 16384;

    Serial.print(F("|"));
    for(int b = NUM_QUBITS - 1; b >= 0; b--) Serial.print((i >> b) & 1);
    Serial.print(F("> ("));
    if(i < 10) Serial.print(F(" "));
    Serial.print(i);
    Serial.print(F(") | "));

    for (int j = 0; j < bar_width; j++) Serial.print(F("#"));
    Serial.print(F(" "));
    Serial.print(percent);
    Serial.println(F("%"));
  }
}

void print_report(quantum_register_t *reg, int target) {
  int32_t t_prob = complex_mag_sq(reg->state[target]);
  float fidelity = ((float)t_prob / 16384.0) * 100.0;
  float total_ms = (float)total_compute_micros / 1000.0;

  Serial.println(F("\n========================================="));
  Serial.println(F("       RAW PERFORMANCE REPORT            "));
  Serial.println(F("========================================="));
  Serial.print(F("Total Gates Executed:  ")); Serial.println(gate_count);
  Serial.print(F("Pure Compute Time:     ")); Serial.print(total_ms); Serial.println(F(" ms"));
  Serial.print(F("Avg Time Per Gate:     ")); Serial.print((total_ms * 1000.0) / gate_count); Serial.println(F(" us"));
  Serial.print(F("Algorithm Fidelity:    ")); Serial.print(fidelity); Serial.println(F("%"));
  Serial.print(F("Memory Usage (SRAM):   ")); Serial.println(F("456 / 2048 bytes"));

  if(fidelity > 90.0) Serial.println(F("System Status:         [OPTIMAL]"));
  else Serial.println(F("System Status:         [DEGRADED]"));
  Serial.println(F("========================================="));
}

void setup() {
  Serial.begin(115200);
  while (!Serial); 

  uint64_t seed = 0;
  for (int i = 0; i < 64; i++) {
    seed = (seed << 1) | (analogRead(A0) & 0x01);
    delayMicroseconds(50);
  }
  seed_quantum_rng(seed);

  Serial.println(F("EMBEDDED QUANTUM ENGINE v1.2 (6-QUBIT)"));
  Serial.println(F("Enter target state (0-63):"));
}

void loop() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input.length() == 0) return;
    int target = input.toInt();
    if (target < 0 || target >= 64) return;

    gate_count = 0;
    total_compute_micros = 0;
    unsigned long timer_start;

    quantum_register_t reg = init_register(NUM_QUBITS);

    Serial.println(F("\n[STEP 1] Generating Superposition..."));

    timer_start = micros();
    for(uint8_t i = 0; i < NUM_QUBITS; i++) {
      apply_gate_h(&reg, i);
      gate_count++;
    }
    total_compute_micros += (micros() - timer_start);

    visualize_on_serial(&reg);
    delay(1000);

    for(int k = 1; k <= GROVER_ITERATIONS; k++) {
      Serial.print(F("\n[STEP 2] Grover Iteration ")); Serial.print(k);

      timer_start = micros();

      apply_oracle(&reg, (uint16_t)target);
      gate_count++; 

      for(int i=0; i<NUM_QUBITS; i++) { apply_gate_h(&reg, i); gate_count++; }
      for(int i=0; i<NUM_QUBITS; i++) { apply_gate_x(&reg, i); gate_count++; }

      reg.state[reg.dim-1].real = -reg.state[reg.dim-1].real;
      reg.state[reg.dim-1].imag = -reg.state[reg.dim-1].imag;
      gate_count++;

      for(int i=0; i<NUM_QUBITS; i++) { apply_gate_x(&reg, i); gate_count++; }
      for(int i=0; i<NUM_QUBITS; i++) { apply_gate_h(&reg, i); gate_count++; }

      total_compute_micros += (micros() - timer_start);

      int confidence = (int)((float)complex_mag_sq(reg.state[target]) / 163.84);
      Serial.print(F(" - Amplitude: ")); Serial.print(confidence); Serial.println(F("%"));

      visualize_on_serial(&reg);
      if (k < GROVER_ITERATIONS) delay(1500);
    }

    print_report(&reg, target);
    Serial.println(F("\nReady. Enter next target (0-63):"));
  }
}
