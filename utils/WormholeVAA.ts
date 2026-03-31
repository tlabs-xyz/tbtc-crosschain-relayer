import { ethers } from 'ethers';
import { NETWORK } from '../config/schemas/common.schema.js';
import logger, { logErrorContext } from './Logger.js';

// Wormhole Token Bridge addresses on Ethereum L1, validated at module load.
const WORMHOLE_TOKEN_BRIDGE: Record<string, string> = {
  [NETWORK.MAINNET]: ethers.utils.getAddress('0x3ee18B2214AFF97000D974cf647E7C347E8fa585'),
  [NETWORK.TESTNET]: ethers.utils.getAddress('0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78'),
};

/**
 * Fetches a signed VAA from the Wormhole API for a given transfer sequence.
 * Makes a single attempt and returns null if the VAA is not yet available (404)
 * or if any error occurs. Retry cadence is managed by the caller's scheduling loop.
 *
 * This is an L1 Ethereum concern shared by all chain handlers — the emitter
 * is always the Wormhole Token Bridge on Ethereum regardless of destination chain.
 *
 * @param sequence - The Wormhole transfer sequence number
 * @param network - The network (Mainnet/Testnet) to determine API endpoint and emitter chain
 * @returns Base64-encoded VAA string, or null if not yet available
 */
export async function fetchVAAFromAPI(sequence: string, network: string): Promise<string | null> {
  try {
    const emitterChain = network === NETWORK.MAINNET ? '2' : '10002';

    const tokenBridgeAddress =
      WORMHOLE_TOKEN_BRIDGE[network] ?? WORMHOLE_TOKEN_BRIDGE[NETWORK.TESTNET];
    const emitterAddress = tokenBridgeAddress.slice(2).toLowerCase().padStart(64, '0');
    logger.debug(`Wormhole emitter address for ${network}: ${emitterAddress}`);

    const vaaId = `${emitterChain}/${emitterAddress}/${sequence}`;
    logger.debug(`Fetching VAA with ID: ${vaaId}`);

    const wormholeApi =
      network === NETWORK.MAINNET
        ? 'https://api.wormholescan.io'
        : 'https://api.testnet.wormholescan.io';

    try {
      const response = await fetch(`${wormholeApi}/api/v1/vaas/${vaaId}`);

      if (response.ok) {
        const data = await response.json();
        if (data && data.data && data.data.vaa) {
          logger.info(`VAA found for sequence ${sequence}!`);
          return data.data.vaa;
        }
      } else if (response.status === 404) {
        logger.debug(`VAA not ready yet for sequence ${sequence}`);
      } else {
        logger.warn(`Unexpected response status ${response.status} when fetching VAA`);
      }
    } catch (error: any) {
      logger.warn(`Error fetching VAA: ${error.message}`);
    }

    return null;
  } catch (error: any) {
    logErrorContext(`Error in fetchVAAFromAPI for sequence ${sequence}`, error);
    return null;
  }
}
