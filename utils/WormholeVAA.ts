import { NETWORK } from '../config/schemas/common.schema.js';
import logger, { logErrorContext } from './Logger.js';

/**
 * Fetches a signed VAA from the Wormhole API for a given transfer sequence.
 * Makes a single attempt and returns null if not yet available.
 * Retry cadence is handled by the caller (processWormholeBridging cron).
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(`${wormholeApi}/api/v1/vaas/${vaaId}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      const MAX_RESPONSE_BYTES = 1_000_000; // 1 MB
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        logger.warn(`VAA response unexpectedly large (${text.length} chars) for sequence ${sequence} — skipping`);
        return null;
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        logger.warn(`Failed to parse VAA response as JSON for sequence ${sequence}`);
        return null;
      }
      if (data && data.data && data.data.vaa) {
        logger.info(`VAA found for sequence ${sequence}!`);
        return data.data.vaa;
      }
    } else if (response.status === 404) {
      logger.debug(`VAA not yet available for sequence ${sequence}`);
    } else if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      logger.warn(
        `Wormhole API rate-limited for sequence ${sequence}${retryAfter ? ` (retry-after: ${retryAfter}s)` : ''}`,
      );
    } else {
      logger.warn(`Unexpected response status ${response.status} when fetching VAA for sequence ${sequence}`);
    }

    return null;
  } catch (error: any) {
    logErrorContext(`Error in fetchVAAFromAPI for sequence ${sequence}`, error);
    return null;
  }
}
