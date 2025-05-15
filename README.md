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

To run the project using Docker, follow these steps:

1. Edit `docker-compose.dev.yml` with your customizations:

   - PRIVATE_KEY: The wallet private key you will use in your application.
   - L1_RPC: URL for the Layer 1 RPC (e.g., Ethereum)
   - L2_RPC: URL for the Layer 2 RPC (e.g., Arbitrum, Base, Optimism)

2. Run the following command to start the project:
   ```bash
   docker compose -f docker-compose.dev.yml up
   ```

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



