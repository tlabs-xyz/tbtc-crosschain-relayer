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

## Project Overview

This project is built with NodeJS and includes a variety of libraries to facilitate development. The project is configured to use Docker for easy setup and deployment.

**Multi-Chain Support**: This relayer is designed to operate with multiple blockchain configurations simultaneously. Each configured chain operates independently, with its own listeners, transaction processing, and data storage (isolated by `chainId` in the database).

## Docker Setup

To run the project in a development environment using Docker, follow these steps:

1. Create a `.env` file by copying the example:

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

## Configuration

The relayer supports multiple blockchain configurations, managed via environment variables and configuration files.

### Supported Chains

The primary way to control which chains the relayer actively operates on is through the `SUPPORTED_CHAINS` environment variable. This should be a comma-separated list of chain keys that correspond to configurations defined in `config/index.ts` (e.g., `sepoliaTestnet`, `solanaDevnet`, or custom keys like `myEvmChain`).

**Example `.env`:**

```
SUPPORTED_CHAINS=sepoliaTestnet,solanaDevnet
# Or for custom/mock chains used in development:
# SUPPORTED_CHAINS=mockEVM1,mockEVM2
```

If `SUPPORTED_CHAINS` is not set or is empty, the relayer will attempt to initialize all chain configurations defined in `config/index.ts` that parse successfully.

### Chain-Specific Configuration

Each chain requires specific configuration parameters, typically provided via environment variables. Refer to `.env.example` for a comprehensive list. Key variables for each chain often include:

- `*_PRIVATE_KEY`: Private key for the relayer's account on that chain.
- `*_L1_RPC_URL`, `*_L2_RPC_URL`, `*_L2_WS_RPC_URL`: RPC and WebSocket endpoints.
- `*_L1_CONTRACT_ADDRESS`, `*_L2_CONTRACT_ADDRESS`: Addresses of relevant smart contracts.
- And other chain-specific parameters like Wormhole gateway addresses, start blocks, etc.

The prefix (e.g., `SEPOLIA_TESTNET_*`, `SOLANA_DEVNET_*`, `MOCK_EVM1_*`) for these environment variables should generally align with the chain key used in `SUPPORTED_CHAINS` and defined in the chain input files (see below).

### Adding a New Chain Configuration

To add support for a new chain:

1.  **Create a Chain Input File**: In the `config/chain/` directory, create a new file (e.g., `myCustomEvm.chain.ts`). This file will export a configuration input object. You can use existing files like `sepolia.chain.ts` or `mockEvm1.chain.ts` as a template. This input object typically sources its values from environment variables using `getEnv()`.

    ```typescript
    // Example: config/chain/myCustomEvm.chain.ts
    import { z } from 'zod';
    import { NETWORK, CHAIN_TYPE, EthereumAddressSchema } from '../schemas/common.schema.js';
    import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
    import { getEnv } from '../../utils/Env.js';

    type MyCustomEvmInput = z.input<typeof EvmChainConfigSchema>;

    export const myCustomEvmChainInput: MyCustomEvmInput = {
      chainType: CHAIN_TYPE.EVM,
      chainName: 'MyCustomEVM', // This will be the key for SUPPORTED_CHAINS
      network: NETWORK.MAINNET, // Or TESTNET
      chainId: parseInt(getEnv('MY_CUSTOM_EVM_CHAIN_ID', '12345')),
      privateKey: getEnv('MY_CUSTOM_EVM_PRIVATE_KEY'),
      l1Rpc: getEnv('MY_CUSTOM_EVM_L1_RPC_URL'),
      l2Rpc: getEnv('MY_CUSTOM_EVM_L2_RPC_URL'),
      l2WsRpc: getEnv('MY_CUSTOM_EVM_L2_WS_RPC_URL'),
      l1ContractAddress: getEnv('MY_CUSTOM_EVM_L1_CONTRACT_ADDRESS') as z.infer<
        typeof EthereumAddressSchema
      >,
      // ... add all other required fields from EvmChainConfigSchema and CommonChainConfigSchema
    };
    ```

2.  **Register in `config/index.ts`**: Import your new input object and add an entry to the `chainSchemaRegistry` using a unique key (this key is what you'd use in `SUPPORTED_CHAINS`).

    ```typescript
    // In config/index.ts
    import { EvmChainConfigSchema } from './schemas/evm.chain.schema.js';
    import { myCustomEvmChainInput } from './chain/myCustomEvm.chain.js';
    // ... other imports

    const chainSchemaRegistry = {
      // ... existing entries
      myCustomEVM: { schema: EvmChainConfigSchema, input: myCustomEvmChainInput },
      // The key 'myCustomEVM' should match chainName in your input for consistency,
      // and is what you use in SUPPORTED_CHAINS.
    };
    ```

3.  **Update Environment Variables**: Ensure all environment variables referenced in your new chain input file (e.g., `MY_CUSTOM_EVM_PRIVATE_KEY`, `MY_CUSTOM_EVM_L1_RPC_URL`) are defined in your `.env` file or deployment environment.

4.  **Add to `SUPPORTED_CHAINS`**: Include the new chain key (e.g., `myCustomEVM`) in the `SUPPORTED_CHAINS` environment variable for the relayer to activate it.

## API Endpoints

Most API endpoints are now chain-specific and require a `chainName` (or `chainId` as referred to internally, but `chainName` is used in the path) as part of the URL path.

**Example:**

- Get deposit status: `GET /api/:chainName/deposit/:depositId`
  - e.g., `GET /api/sepoliaTestnet/deposit/0x123...`
  - e.g., `GET /api/mockEVM1/deposit/0xabc...`
- Reveal deposit: `POST /api/:chainName/reveal`
  - e.g., `POST /api/myCustomEVM/reveal`

Refer to the route definitions in `routes/index.ts` and associated controllers for details on available endpoints and their parameters.

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

Database records for chain-specific data (like deposits) are isolated by a `chainId` field. This was added via a database migration. Ensure migrations have run if you are upgrading an existing deployment.

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
