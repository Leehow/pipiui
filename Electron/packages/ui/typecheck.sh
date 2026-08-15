#!/bin/sh
cd "$(dirname "$0")"
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
