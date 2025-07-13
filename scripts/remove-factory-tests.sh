#!/bin/bash
# Script to remove factory pattern test files

echo "Removing factory pattern test files..."

# Remove factory-specific test files
rm -f tests/unit/config/factory/ConfigurationFactory.test.ts
rm -f tests/helpers/TestFactoryRegistry.ts

# Update configHelper.ts to remove factory imports
echo "Test files removed. Manual updates needed for:"
echo "- tests/helpers/configHelper.ts"
echo "- tests/unit/config/configurationIntegration.test.ts"

echo "Done!"