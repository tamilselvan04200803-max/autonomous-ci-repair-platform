PYTHON ?= .venv/Scripts/python.exe
PY_ENV = PYTHONDONTWRITEBYTECODE=1

.PHONY: bench-replay report verify

bench-replay:
	$(PY_ENV) $(PYTHON) -B scripts/validate_benchmarks.py
	$(PY_ENV) $(PYTHON) -B scripts/run_localization_experiment.py
	$(PY_ENV) $(PYTHON) -B scripts/generate_report.py

report:
	$(PY_ENV) $(PYTHON) -B scripts/generate_report.py

verify:
	$(PY_ENV) $(PYTHON) -B -m ruff check aegis tests scripts
	$(PY_ENV) $(PYTHON) -B -m mypy --strict aegis
	$(PY_ENV) $(PYTHON) -B -m pytest -m "not integration" -q
	$(PY_ENV) $(PYTHON) -B scripts/check_secrets.py
