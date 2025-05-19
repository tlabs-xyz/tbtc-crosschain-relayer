import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20', // TODO: Match to contract version
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Default Hardhat network
      chainId: 31337,
    },
    l1_mock: {
      url: 'http://127.0.0.1:8545',
      chainId: 1337,
    },
    l2_mock: {
      url: 'http://127.0.0.1:9545',
      chainId: 1338,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 40000,
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v5',
  },
};

export default config;
