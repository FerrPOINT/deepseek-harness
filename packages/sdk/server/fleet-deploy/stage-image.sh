#!/usr/bin/env bash
set -euo pipefail
if [ "$#" != 1 ]; then
  echo 'Usage: stage-image.sh NEW_BUILD_CONTEXT' >&2
  exit 2
fi
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
git -C "$root" diff --quiet HEAD -- packages/sdk/server packages/core/agent-loop packages/core/agent
if [ -n "$(git -C "$root" ls-files --others --exclude-standard -- packages/sdk/server packages/core/agent-loop packages/core/agent)" ]; then
  echo 'Commit the DSH Fleet image inputs before assembling a candidate' >&2
  exit 2
fi
node "$root/node_modules/typescript/bin/tsc" -b "$root/packages/core/agent-loop" "$root/packages/sdk/server"
mkdir -- "$1"
context="$(realpath -- "$1")"
recipe="$root/packages/sdk/server/fleet-deploy"
cp -- "$recipe/Dockerfile" "$recipe/package.json" "$recipe/package-lock.json" "$context/"
cp -R -- "$root/packages/sdk/server/src/fleet" "$context/fleet"
for package in agent-loop sdk-server; do
  if [ "$package" = agent-loop ]; then
    source="$root/packages/core/agent-loop"
  else
    source="$root/packages/sdk/server"
  fi
  (
    cd "$source"
    node "$root/node_modules/tsdown/dist/run.mjs" --no-config --no-dts --format esm --target es2024 \
      --out-dir "$context/$package" lib/types/index.js
  )
  node --check "$context/$package/index.mjs"
  mv -- "$context/$package/index.mjs" "$context/$package.mjs"
  rmdir -- "$context/$package"
done
git -C "$root" rev-parse HEAD > "$context/source-revision"
