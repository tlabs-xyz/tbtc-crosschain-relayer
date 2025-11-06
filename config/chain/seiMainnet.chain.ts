import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SeiChainConfigSchema } from '../schemas/sei.chain.schema.js';
import { getEnv } from '../../utils/Env.js';
import { getSeiCommonInput } from './sei-common.js';
import { PUBLIC_RPCS } from './common.chain.js';

type SeiChainInput = z.input<typeof SeiChainConfigSchema>;

// Sei Mainnet (Pacific-1, Chain ID: 1329) Configuration
export const getSeiMainnetChainInput = (): SeiChainInput => {
  const commonMainnetSeiInput = getSeiCommonInput(NETWORK.MAINNET);

  // Validate required properties from commonMainnetSeiInput
  const requiredFields: Array<keyof Partial<SeiChainInput>> = [
    'network',
    'chainType',
    'l1Rpc',
    'vaultAddress',
    'l1BitcoinDepositorAddress',
    'l1Confirmations',
    'useEndpoint',
    'l2TokenAddress',
  ];
  for (const field of requiredFields) {
    if (
      typeof field === 'string' &&
      (commonMainnetSeiInput[field] === undefined ||
        commonMainnetSeiInput[field] === null)
    ) {
      throw new Error(
        `getSeiMainnetChainInput: Missing required field '${String(field)}' in commonMainnetSeiInput.`,
      );
    }
  }

  const config: SeiChainInput = {
    network: commonMainnetSeiInput.network,
    chainType: commonMainnetSeiInput.chainType,
    l1Rpc: commonMainnetSeiInput.l1Rpc!,
    vaultAddress: getEnv(
      'SEI_MAINNET_VAULT_ADDRESS',
      commonMainnetSeiInput.vaultAddress as string,
    ),
    l1BitcoinDepositorAddress: getEnv(
      'SEI_MAINNET_L1_CONTRACT_ADDRESS',
      commonMainnetSeiInput.l1BitcoinDepositorAddress as string,
    ),
    l1Confirmations: commonMainnetSeiInput.l1Confirmations,
    useEndpoint: commonMainnetSeiInput.useEndpoint,
    enableL2Redemption: false, // Sei does not support L2 redemption (NTT pattern)
    supportsRevealDepositAPI: commonMainnetSeiInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetSeiInput.endpointUrl,
    l2TokenAddress: getEnv(
      'SEI_MAINNET_L2_TOKEN_ADDRESS',
      commonMainnetSeiInput.l2TokenAddress as string,
    ),
    wormholeChainId: commonMainnetSeiInput.wormholeChainId,
    l1BitcoinDepositorStartBlock: Number(getEnv(
      'SEI_MAINNET_L1_DEPOSITOR_START_BLOCK',
      '23570676',
    )),
    l2Rpc: getEnv('SEI_MAINNET_L2_RPC', PUBLIC_RPCS['sei-mainnet']),

    chainName: 'SeiMainnet',
    // L1 private key for endpoint mode (to pay for L1 transactions on Ethereum)
    privateKey: getEnv('CHAIN_SEI_MAINNET_PRIVATE_KEY'),
  };
  return config;
};

