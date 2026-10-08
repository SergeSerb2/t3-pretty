#!/usr/bin/env bash
# Focused Relay snapshot gate. Typecheck does not see drizzle journal
# drift: an upstream nightly can add a linear successor whose snapshot
# omits Pretty-only tables or indexes, and Alchemy then regenerates
# CREATE TABLE/INDEX against prod. This is the tripwire for that class.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/infra/relay"

vp test run src/persistence/migrations.test.ts
