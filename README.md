# tBTC Cross-Chain Relayer

A service for relaying tBTC deposits between Ethereum (L1) and multiple Layer 2 blockchains (EVM, Sui, Starknet, and others) with a specialized Sui VAA relayer.

## Overview

The tBTC Cross-Chain Relayer is a Node.js service that facilitates cross-chain transfers of tBTC tokens between Layer 1 (Ethereum) and various Layer 2 blockchains using Wormhole as the messaging protocol. It consists of two main components:

1. **Main Relayer (`index.ts`)**: Monitors deposit events on multiple L2 chains (EVM, Sui, Starknet, others), initializes and finalizes deposits on L1.
2. **Sui VAA Relayer (`bin/vaa-relayer.ts`)**: Specifically for Sui - monitors Wormhole TokensTransferredWithPayload events on Ethereum and relays the VAAs to the Sui blockchain.

## Features

- Multi-chain support - relay between Ethereum and various L2 chains
- Specialized Ethereum to Sui bridging via Wormhole VAAs
- Monitoring and processing deposit events
- Automatic retry with exponential backoff
- Configurable via environment variables
- Docker support for easy deployment

## Architecture

```
┌──────────────────┐     ┌───────────────┐     ┌───────────────┐
│   Ethereum L1    │     │    Wormhole   │     │ Multiple L2s  │
│  (tBTC Tokens)   │◄────┤   Protocol    ├────►│ EVM/Sui/Other │
└──────────────────┘     └───────────────┘     └───────────────┘
         ▲                                             ▲
         │                                             │
         │                                             │
         │                                             │
┌────────┴─────────────────────────────────────────────┴──────────┐
│                                                                 │
│                      tBTC Cross-Chain Relayer                   │
│                                                                 │
│  ┌──────────────────────┐          ┌────────────────────────┐  │
│  │     Main Relayer     │          │    Sui VAA Relayer     │  │
│  │      (index.ts)      │          │  (bin/vaa-relayer.ts)  │  │
│  │  Multi-chain Support │          │     Sui-specific       │  │
│  └──────────────────────┘          └────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js v16+ (v20+ recommended)
- Yarn or NPM
- Access to Ethereum and Layer 2 RPC endpoints
- Private keys for transaction signing
- Chain-specific configuration (object IDs for Sui, etc.)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/tbtc-crosschain-relayer.git
cd tbtc-crosschain-relayer

# Install dependencies
yarn install
```

## Configuration

Copy the example environment file and edit it with your settings:

```bash
cp .env.example .env
```

### Important Environment Variables:

#### General Configuration:
- `APP_PORT`: Port for the Express server (default: 3000)
- `JSON_PATH`: Path to store deposit data (default: ./data/)

#### L1 Configuration (Ethereum):
- `L1_CHAIN_TYPE`: Always 'evm' for Ethereum
- `L1_RPC`: Ethereum RPC endpoint URL
- `L1_CONTRACT_ADDRESS`: Address of the L1BitcoinDepositor contract
- `L1_VAULT_ADDRESS`: Address of the tBTC Vault contract
- `L1_PRIVATE_KEY`: Private key for L1 transactions

#### L2 Configuration:
- `L2_CHAIN_TYPE`: Chain type ('evm', 'sui', 'starknet', etc.)
- `L2_CHAIN_NAME`: Name of the L2 chain
- `L2_RPC`: L2 chain RPC endpoint URL
- `L2_CONTRACT_ADDRESS`: The L2 contract address (format depends on chain type)
- `L2_PRIVATE_KEY`: Chain-specific private key format

#### Sui-Specific Object IDs (only needed when L2_CHAIN_TYPE=sui):
- `SUI_RECEIVER_STATE_ID`: Receiver state object ID
- `SUI_GATEWAY_STATE_ID`: Gateway state object ID
- `SUI_GATEWAY_CAPABILITIES_ID`: Gateway capabilities object ID
- `SUI_TREASURY_ID`: Treasury object ID
- `SUI_WORMHOLE_STATE_ID`: Wormhole state object ID
- `SUI_TOKEN_BRIDGE_STATE_ID`: Token bridge state object ID
- `SUI_TBTC_TOKEN_STATE_ID`: tBTC token state object ID

#### Wormhole Configuration:
- `WH_TOKEN_BRIDGE_ADDRESS`: Address of the Wormhole Token Bridge
- `WH_EMITTER_CHAIN`: Wormhole chain ID for Ethereum (usually 2)
- `WH_EMITTER_ADDRESS`: Wormhole emitter address (L1BitcoinDepositor)

## Running the Relayers

### Development Mode

To run the main relayer in development mode:

```bash
yarn dev
```

To run the VAA relayer in development mode:

```bash
yarn vaa-relayer
```

### Production Mode

To build and run the main relayer:

```bash
yarn build
yarn start
```

To build and run the VAA relayer:

```bash
yarn build:vaa-relayer
```

## Docker Deployment

### Building the Docker Image

```bash
docker build -t tbtc-crosschain-relayer .
```

### Running with Docker Compose

Create a `docker-compose.yml` file in your project:

```bash
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  app:
    build: .
    container_name: tbtc_relayer_app
    restart: unless-stopped
    ports:
      - "${APP_PORT:-3000}:3000"
    env_file:
      - .env
    command: ["node", "dist/index.js"]
    networks:
      - tbtc_network

  vaa_relayer:
    build: .
    container_name: tbtc_vaa_relayer
    restart: unless-stopped
    depends_on:
      - app
    env_file:
      - .env
    command: ["node", "dist/bin/vaa-relayer.js"]
    networks:
      - tbtc_network

networks:
  tbtc_network:
    driver: bridge
EOF
```

Run both relayers:

```bash
docker compose up -d
```

## Logs and Monitoring

View logs for the containers:

```bash
# Main Relayer logs
docker compose logs -f app

# VAA Relayer logs
docker compose logs -f vaa_relayer
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the terms of the ISC license. 