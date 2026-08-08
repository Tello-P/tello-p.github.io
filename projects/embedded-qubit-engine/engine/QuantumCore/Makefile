BOARD_TAG    = arduino:avr:uno
	PORT         = /dev/ttyACM0
	BAUD         = 115200
	SKETCH       = .

CLI          = arduino-cli

all: compile upload monitor

compile:
	@echo "--- Compiling Quantum Engine for $(BOARD_TAG) ---"
	$(CLI) compile --fqbn $(BOARD_TAG) $(SKETCH)

upload:
	@echo "--- Uploading to $(PORT) ---"
	$(CLI) upload -p $(PORT) --fqbn $(BOARD_TAG) $(SKETCH)

monitor:
	@echo "--- Opening Monitor (Ctrl+C to exit) ---"
	$(CLI) monitor -p $(PORT) --config baudrate=$(BAUD)

clean:
	@echo "--- Cleaning Build Cache ---"
	rm -rf build/

test: compile upload monitor

.PHONY: all compile upload monitor clean test
