#!/bin/bash

# Run integration tests for the Sprites JavaScript SDK
# This script mirrors the Go SDK's run_integration_tests.sh

set -e

# Check if SPRITES_TEST_TOKEN is set
if [ -z "$SPRITES_TEST_TOKEN" ]; then
    echo "Error: SPRITES_TEST_TOKEN environment variable must be set"
    exit 1
fi

# Build the SDK first
echo "Building SDK..."
npm run build

# Run integration tests
echo "Running integration tests..."
node --test dist/integration.test.js

echo "Integration tests completed successfully!"

