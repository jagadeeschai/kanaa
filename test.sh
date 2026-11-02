#!/bin/sh
# Runs every Motion test. Tests use temporary data, never backend/.data.
set -e
cd "$(dirname "$0")"
(cd backend && PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -p 'test_*.py')
(cd frontend && npm test --silent && npx tsc --noEmit)
