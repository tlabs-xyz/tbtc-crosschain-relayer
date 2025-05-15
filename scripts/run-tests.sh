#!/bin/bash

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ensure script is run from the project root
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: This script must be run from the project root directory.${NC}"
  exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  yarn install
fi

# Create needed directories
mkdir -p tests/data
mkdir -p tests/logs

# Run tests based on argument
case "$1" in
  "unit")
    echo -e "${GREEN}Running unit tests...${NC}"
    yarn test:unit
    ;;
  "integration")
    echo -e "${GREEN}Running integration tests...${NC}"
    yarn test:integration
    ;;
  "e2e")
    echo -e "${GREEN}Running end-to-end tests...${NC}"
    yarn test:e2e
    ;;
  "coverage")
    echo -e "${GREEN}Running tests with coverage...${NC}"
    yarn test:coverage
    ;;
  "all" | "")
    echo -e "${GREEN}Running all tests...${NC}"
    yarn test
    ;;
  *)
    echo -e "${RED}Unknown test type: $1${NC}"
    echo -e "Usage: ./scripts/run-tests.sh [unit|integration|e2e|coverage|all]"
    exit 1
    ;;
esac

# Handle exit code
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Tests completed successfully!${NC}"
  exit 0
else
  echo -e "${RED}Tests failed!${NC}"
  exit 1
fi 