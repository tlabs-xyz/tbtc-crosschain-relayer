import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SeiChainConfigSchema } from '../schemas/sei.chain.schema.js';
import { getEnv } from '../../utils/Env.js';
import { getSeiCommonInput } from './sei-common.js';
import { PUBLIC_RPCS } from './common.chain.js';

type SeiChainInput = z.input<typeof SeiChainConfigSchema>;

// Sei Testnet (Atlantic-2) Configuration
export const getSeiTestnetChainInput = (): SeiChainInput => {
  const commonTestnetSeiInput = getSeiCommonInput(NETWORK.TESTNET);

  // Validate required properties from commonTestnetSeiInput
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
      (commonTestnetSeiInput[field] === undefined ||
        commonTestnetSeiInput[field] === null)
    ) {
      throw new Error(
        `getSeiTestnetChainInput: Missing required field '${String(field)}' in commonTestnetSeiInput.`,
      );
    }
  }

  const config: SeiChainInput = {
    network: commonTestnetSeiInput.network,
    chainType: commonTestnetSeiInput.chainType,
    l1Rpc: commonTestnetSeiInput.l1Rpc!,
    vaultAddress: getEnv(
      'SEI_TESTNET_VAULT_ADDRESS',
      commonTestnetSeiInput.vaultAddress as string,
    ),
    l1BitcoinDepositorAddress: getEnv(
      'SEI_TESTNET_L1_CONTRACT_ADDRESS',
      commonTestnetSeiInput.l1BitcoinDepositorAddress as string,
    ),
    l1Confirmations: commonTestnetSeiInput.l1Confirmations,
    useEndpoint: commonTestnetSeiInput.useEndpoint,
    enableL2Redemption: false, // Sei does not support L2 redemption (NTT pattern)
    supportsRevealDepositAPI: commonTestnetSeiInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetSeiInput.endpointUrl,
    l2TokenAddress: getEnv(
      'SEI_TESTNET_L2_TOKEN_ADDRESS',
      commonTestnetSeiInput.l2TokenAddress as string,
    ),
    wormholeChainId: commonTestnetSeiInput.wormholeChainId,
    l1BitcoinDepositorStartBlock: Number(getEnv(
      'SEI_TESTNET_L1_DEPOSITOR_START_BLOCK',
      '0',
    )),
    l2Rpc: getEnv('SEI_TESTNET_L2_RPC', PUBLIC_RPCS['sei-testnet']),

    chainName: 'SeiTestnet',
    // L1 private key for endpoint mode (to pay for L1 transactions on Ethereum)
    privateKey: getEnv('CHAIN_SEI_TESTNET_PRIVATE_KEY'),
  };
  return config;
};

