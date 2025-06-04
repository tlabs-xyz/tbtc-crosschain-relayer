#!/bin/bash
set -e

echo "Testing CI Docker Setup..."
echo "========================="

# Build and start services
echo "1. Building and starting Docker services..."
docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --build

# Wait for services to be healthy
echo "2. Waiting for services to become healthy..."
.github/scripts/wait-for-healthy-services.sh

# Test service endpoints
echo "3. Testing service endpoints..."
echo "Testing /status endpoint..."
curl -f http://localhost:3000/status || echo "Failed to reach /status endpoint"

echo "Testing root endpoint..."
curl -f http://localhost:3000/ || echo "Failed to reach root endpoint"

# Validate configuration
echo "4. Validating configuration..."
docker compose -f docker-compose.yml -f docker-compose.ci.yml run --rm tbtc-relayer-dev yarn run validate-config:test

# Clean up
echo "5. Cleaning up..."
docker compose -f docker-compose.yml -f docker-compose.ci.yml down

echo "✅ CI Docker setup test completed successfully!" 