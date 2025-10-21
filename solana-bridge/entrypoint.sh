#!/bin/sh

echo "🔧 Running dependency fixes..."
node fix-dependencies.js

echo "🚀 Starting Solana Bridge Service..."
exec node index.js
