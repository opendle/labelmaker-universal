#!/bin/sh
set -eu

REPOSITORY_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPOSITORY_ROOT"

# Xcode Cloud supplies Homebrew, but does not prepare the Node.js workspace.
brew install node@24
NODE_PREFIX="$(brew --prefix node@24)"
export PATH="$NODE_PREFIX/bin:$PATH"

node --version
npm --version
# The iOS web build needs dev dependencies, but does not need Electron binaries.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --include=dev
npm run build:web --workspace @labelmaker/ipad
