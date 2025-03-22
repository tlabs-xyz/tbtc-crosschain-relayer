#!/bin/bash

# Define colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Install missing dependencies if needed
echo -e "${BLUE}Checking for required dependencies...${NC}"
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  npm install
fi

# Create needed directories
mkdir -p tests/data
mkdir -p tests/logs

# Run tests based on argument
case "$1" in
  "unit")
    echo -e "${GREEN}Running unit tests...${NC}"
    npm run test:unit
    ;;
  "integration")
    echo -e "${GREEN}Running integration tests...${NC}"
    npm run test:integration
    ;;
  "e2e")
    echo -e "${GREEN}Running end-to-end tests...${NC}"
    npm run test:e2e
    ;;
  "coverage")
    echo -e "${GREEN}Running tests with coverage...${NC}"
    npm run test:coverage
    ;;
  "all" | "")
    echo -e "${GREEN}Running all tests...${NC}"
    npm test
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