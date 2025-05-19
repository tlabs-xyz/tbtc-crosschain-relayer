import { HardhatUserConfig } from 'hardhat/config';

// Minimal config to start L1 node with specific chainId
const config: HardhatUserConfig = {
  solidity: '0.8.20',
  networks: {
    hardhat: {
      chainId: 1337,
      // accounts: [],
    },
  },
};

export default config;
