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
* Once the container is running, the application should be accessible on your host machine at `http://localhost:${PORT}`.
* The service uses `ts-node-dev` for hot-reloading, so changes you make to your TypeScript source code will automatically trigger a server restart within the container.

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



