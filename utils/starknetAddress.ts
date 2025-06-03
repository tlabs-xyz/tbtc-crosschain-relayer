import { CallData } from 'starknet';
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import logger from './Logger.js';

// Constants for StarkNet address validation
const STARKNET_ADDRESS_MIN_LENGTH = 3; // '0x0'
const STARKNET_ADDRESS_MAX_LENGTH = 66; // '0x' + 64 hex chars (32 bytes)
const STARKNET_FELT252_MAX_BYTES = 32; // Felt252 is at most 32 bytes

/**
 * Validates a StarkNet address (felt252 format).
 *
 * StarkNet addresses are represented as felt252 values, which are:
 * - Hexadecimal strings starting with '0x'
 * - At most 252 bits (31.5 bytes), but commonly padded to 32 bytes
 * - Can be shorter if leading zeros are omitted
 *
 * @param address - The StarkNet address to validate
 * @returns True if the address is valid, false otherwise
 *
 * @example
 * ```typescript
 * validateStarkNetAddress('0x123abc') // true
 * validateStarkNetAddress('0x0') // true
 * validateStarkNetAddress('invalid') // false
 * ```
 */
export function validateStarkNetAddress(address: string): boolean {
  try {
    // Type and basic format validation
    if (typeof address !== 'string' || !address) {
      return false;
    }

    // Check if it's a valid hex string
    if (!ethers.utils.isHexString(address)) {
      return false;
    }

    // Check length constraints for felt252
    if (
      address.length < STARKNET_ADDRESS_MIN_LENGTH ||
      address.length > STARKNET_ADDRESS_MAX_LENGTH
    ) {
      return false;
    }

    // Use starknet.js CallData.compile for robust validation
    // This will throw if the address cannot be compiled as a valid felt252
    CallData.compile({ addr: address });

    return true;
  } catch (error) {
    // Log validation failures for debugging (at debug level to avoid spam)
    logger.debug(`StarkNet address validation failed for '${address}':`, error);
    return false;
  }
}

/**
 * Formats a StarkNet address (felt252) into a standardized bytes32 hex string for L1 contract calls.
 *
 * This function ensures the address is exactly 32 bytes (64 hex chars + '0x' prefix)
 * by padding with leading zeros if necessary. This is required for Ethereum smart
 * contract interactions where addresses must be bytes32.
 *
 * @param address - The StarkNet address to format (felt252 hex string)
 * @returns The address formatted as a bytes32 hex string (66 chars total)
 * @throws Error if the address is invalid or cannot be formatted
 *
 * @example
 * ```typescript
 * formatStarkNetAddressForContract('0x123')
 * // Returns: '0x0000000000000000000000000000000000000000000000000000000000000123'
 * ```
 */
export function formatStarkNetAddressForContract(address: string): string {
  if (!validateStarkNetAddress(address)) {
    throw new Error(`Invalid StarkNet address for contract formatting: ${address}`);
  }

  try {
    // Ensure exactly 32 bytes (64 hex chars) with leading zero padding
    const formatted = ethers.utils.hexZeroPad(address, STARKNET_FELT252_MAX_BYTES);

    // Verify the formatted result is still a valid StarkNet address
    if (!ethers.utils.isHexString(formatted) || formatted.length !== 66) {
      throw new Error(`Failed to format address to bytes32: result length ${formatted.length}`);
    }

    return formatted;
  } catch (error) {
    const errorMsg = `Failed to format StarkNet address '${address}' for contract: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Extracts a StarkNet address embedded in a Bitcoin P2SH or P2WSH script.
 * This function assumes a specific, simple embedding scheme where the address
 * is pushed as data in the script.
 * For P2SH: OP_HASH160 <20-byte-hash-of-redeem-script> OP_EQUAL
 * For P2WSH: OP_0 <32-byte-hash-of-witness-script>
 * We are looking for a redeem/witness script that pushes the StarkNet address.
 * A common pattern for embedding data is OP_RETURN <data>, or pushing data directly
 * if the script's purpose is data carriage alongside a spendable condition.
 *
 * This simplified example assumes the StarkNet address is the *only* data push
 * in the relevant part of the script. A more robust solution would require
 * a defined protocol for embedding.
 *
 * For this implementation, we'll assume the script being passed IS the redeem script
 * or witness script itself, and it contains a single data push representing the StarkNet address.
 * The address is expected to be a hex string.
 *
 * Example redeem script: <StarkNet_Address_Hex_Padded_To_Some_Length> OP_CHECKSIG (or similar)
 * Or more simply: OP_RETURN <StarkNet_Address_Hex>
 *
 * Given the task description, we're looking for an address *within* a P2(W)SH.
 * The P2(W)SH commits to a hash of another script. That other script (redeem or witness script)
 * would contain the StarkNet address.
 *
 * Let's assume the `script` parameter IS the redeem/witness script itself,
 * and it's expected to contain a data push that is the StarkNet address.
 *
 * @param script The Bitcoin redeem script or witness script (Buffer or hex string).
 * @returns The extracted StarkNet address as a hex string, or null if not found or invalid.
 */
export function extractAddressFromBitcoinScript(script: Buffer | string): string | null {
  try {
    const scriptBuffer = typeof script === 'string' ? Buffer.from(script, 'hex') : script;
    const chunks = bitcoin.script.decompile(scriptBuffer);

    if (!chunks) {
      return null;
    }

    for (const chunk of chunks) {
      if (Buffer.isBuffer(chunk)) {
        const potentialAddress = '0x' + chunk.toString('hex');
        if (validateStarkNetAddress(potentialAddress)) {
          if (chunk.length > 0 && chunk.length <= 32) {
            return potentialAddress;
          }
        }
      }
    }
    return null;
  } catch (error) {
    logger.error('Error extracting address from Bitcoin script:', error);
    return null;
  }
}
