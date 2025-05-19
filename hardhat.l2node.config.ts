import { HardhatUserConfig } from 'hardhat/config';

// Minimal config to start L2 node with specific chainId
const config: HardhatUserConfig = {
  solidity: '0.8.20',
  networks: {
    hardhat: {
      chainId: 1338,
      // accounts: [],
    },
  },
};

export default config;
