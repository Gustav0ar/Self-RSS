#!/usr/bin/env bash
set -euo pipefail

echo "==> Running database migrations..."
cd "$(dirname "$0")/../packages/api"
bun run db:migrate
echo "==> Migrations complete."
