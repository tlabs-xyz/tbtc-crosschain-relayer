import { NETWORK } from '../config/schemas/common.schema.js';
import logger, { logErrorContext } from './Logger.js';

// Wormhole VAA fetch retry configuration
const VAA_FETCH_MAX_ATTEMPTS = 20;
const VAA_FETCH_RETRY_INTERVAL_MS = 30_000; // 30 seconds between retries, ~10 minutes total

/**
 * Fetches a signed VAA from the Wormhole API for a given transfer sequence.
 * Retries up to 20 times with 30-second intervals between attempts.
 *
 * This is an L1 Ethereum concern shared by all chain handlers — the emitter
 * is always the Wormhole Token Bridge on Ethereum regardless of destination chain.
 *
 * @param sequence - The Wormhole transfer sequence number
 * @param network - The network (Mainnet/Testnet) to determine API endpoint and emitter chain
 * @returns Base64-encoded VAA string, or null if not available after all retries
 */
export async function fetchVAAFromAPI(sequence: string, network: string): Promise<string | null> {
  try {
    const emitterChain = network === NETWORK.MAINNET ? '2' : '10002';

    // Wormhole Token Bridge addresses on Ethereum L1
    const tokenBridgeAddress =
      network === NETWORK.MAINNET
        ? '0x3ee18B2214AFF97000D974cf647E7C347E8fa585'
        : '0xDB5492265f6038831E89f495670fF909aDe94bd9';
    const emitterAddress = tokenBridgeAddress.slice(2).toLowerCase().padStart(64, '0');

    const vaaId = `${emitterChain}/${emitterAddress}/${sequence}`;
    logger.debug(`Fetching VAA with ID: ${vaaId}`);

    const wormholeApi =
      network === NETWORK.MAINNET
        ? 'https://api.wormholescan.io'
        : 'https://api.testnet.wormholescan.io';

    let attempts = 0;

    while (attempts < VAA_FETCH_MAX_ATTEMPTS) {
      try {
        const response = await fetch(`${wormholeApi}/api/v1/vaas/${vaaId}`);

        if (response.ok) {
          const data = await response.json();
          if (data && data.data && data.data.vaa) {
            logger.info(`VAA found for sequence ${sequence}!`);
            return data.data.vaa;
          }
        } else if (response.status === 404) {
          logger.debug(
            `VAA not ready yet for sequence ${sequence} (attempt ${attempts + 1}/${VAA_FETCH_MAX_ATTEMPTS})`,
          );
        } else {
          logger.warn(`Unexpected response status ${response.status} when fetching VAA`);
        }
      } catch (error: any) {
        logger.warn(`Error fetching VAA: ${error.message}`);
      }

      attempts++;
      if (attempts < VAA_FETCH_MAX_ATTEMPTS) {
        logger.debug(`Waiting 30 seconds before retry...`);
        await new Promise((resolve) => setTimeout(resolve, VAA_FETCH_RETRY_INTERVAL_MS));
      }
    }

    return null;
  } catch (error: any) {
    logErrorContext(`Error in fetchVAAFromAPI for sequence ${sequence}`, error);
    return null;
  }
}
