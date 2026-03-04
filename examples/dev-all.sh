#!/bin/bash
# Start all 4 framework example dev servers in parallel.
# Auto-installs dependencies if node_modules is missing.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLES_DIR="$ROOT/examples"

install_if_needed() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing deps for $(basename "$dir")..."
    (cd "$dir" && bun install)
  fi
}

# Install deps for framework examples that need their own node_modules
install_if_needed "$EXAMPLES_DIR/nextjs"
install_if_needed "$EXAMPLES_DIR/remix"
install_if_needed "$EXAMPLES_DIR/astro"

# Show framework switcher tabs in all demos
export ENABLE_FRAMEWORK_SWITCHER=true

echo ""
echo "Starting all dev servers..."
echo "  Vite:    http://localhost:5173"
echo "  Next.js: http://localhost:3000"
echo "  Remix:   http://localhost:3001"
echo "  Astro:   http://localhost:4321"
echo ""

# Start all servers in background, wait for all
(cd "$ROOT" && bun run dev) &
(cd "$EXAMPLES_DIR/nextjs" && bun run dev) &
(cd "$EXAMPLES_DIR/remix" && bun run dev) &
(cd "$EXAMPLES_DIR/astro" && bun run dev) &

# Trap Ctrl+C to kill all background jobs
trap 'kill $(jobs -p) 2>/dev/null; exit 0' INT TERM
wait
