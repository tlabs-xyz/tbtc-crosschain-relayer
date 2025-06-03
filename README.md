# Threshold Network | tBTC Cross-Chain Relayer

Based on [L2 tBTC SDK Relayer Implementation](https://thresholdnetwork.notion.site/L2-tBTC-SDK-Relayer-Implementation-4dfedabfcf594c7d8ef80609541cf791?pvs=4)

## Table of Contents

- [Threshold Network | tBTC Cross-Chain Relayer](#threshold-network--tbtc-cross-chain-relayer)
  - [Table of Contents](#table-of-contents)
  - [Project Overview](#project-overview)
  - [Docker Setup](#docker-setup)
  - [How to Start the Project (Local)](#how-to-start-the-project-local)
    - [Development Mode](#development-mode)
  - [Project Scripts](#project-scripts)
  - [CI - GitHub Actions](#ci---github-actions)
  - [Database Management](#database-management)
    - [Automatic Migrations](#automatic-migrations)
    - [Manual Migration](#manual-migration)
    - [Backup Database](#backup-database)
    - [Restore Database](#restore-database)
  - [Testing](#testing)
    - [Test Database Setup](#test-database-setup)
    - [Running Tests](#running-tests)

## Project Overview

This project is built with NodeJS and includes a variety of libraries to facilitate development. The project is configured to use Docker for easy setup and deployment.

## Docker Setup

To run the project in a development environment using Docker, follow these steps:

1. Create a `.env` file:

```bash
cp .env.example .env
```

2. Start the Docker container:

```bash
docker compose up --build
```

3. Access the application:

- Once the container is running, the application should be accessible on your host machine at `http://localhost:${PORT}`.
- The service uses `ts-node-dev` for hot-reloading, so changes you make to your TypeScript source code will automatically trigger a server restart within the container.

## How to Start the Project (Local)

### Development Mode

To start the application in development mode, run:

```bash
npm run dev
```

## Project Scripts

The following npm scripts are avaliable:

    -   `npm run dev`: Runs the application in development mode.
    -   `npm start`: Runs the application in production mode

## CI - GitHub Actions

You can run the CI workflow locally by running:

```bash
gh act
```

## Database Management

### Automatic Migrations
Migrations are run automatically when the app starts in Docker (production mode) using an entrypoint script.

### Manual Migration
To run migrations manually:
```bash
npm run db:migrate
```

### Backup Database
To create a backup (PostgreSQL):
```bash
npm run db:backup
```

### Restore Database
To restore from a backup:
```bash
npm run db:restore
```

## Testing

### Test Database Setup

Integration tests require a separate test database running on port `5433`. Use the provided script to manage the test database:

```bash
# Start the test database
./scripts/test-db.sh start

# Check test database status  
./scripts/test-db.sh status

# View test database logs
./scripts/test-db.sh logs

# Stop the test database
./scripts/test-db.sh stop

# Restart the test database
./scripts/test-db.sh restart
```

The test database will automatically:
- Run PostgreSQL 15 in a Docker container
- Create the `tbtc_relayer_test` database
- Set up the correct schema using Prisma
- Use port `5433` to avoid conflicts with the main database

### Running Tests

```bash
# Run all tests
yarn test

# Run only unit tests
yarn test --testPathPattern="unit"

# Run only integration tests (requires test database)
yarn test --testPathPattern="integration"

# Run a specific test file
yarn test tests/integration/controllers/Endpoint.controller.test.ts
```

**Note:** Integration tests require the test database to be running. Make sure to start it with `./scripts/test-db.sh start` before running integration tests.
