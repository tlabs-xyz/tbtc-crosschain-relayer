#!/bin/bash
# Script to clean up factory pattern remnants

echo "Cleaning up factory pattern directories..."

# Remove factory directories
rm -rf config/factory
rm -rf config/chain/factories
rm -rf config/chain/interfaces

echo "Factory directories removed."

# Run build to verify nothing is broken
echo "Running build to verify..."
yarn build

echo "Cleanup complete!"