import { CallData, CairoOption, CairoOptionVariant } from 'starknet';
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';

/**
 * Validates a StarkNet address.
 *
 * @param address The StarkNet address to validate.
 * @returns True if the address is valid, false otherwise.
 */
export function validateStarkNetAddress(address: string): boolean {
  try {
    // starknet.js's CallData.compile accepts an address and will throw if it's invalid.
    // We can use a simple CairoOption type for validation.
    // A valid address is a felt252, which CallData.compile can handle.
    CallData.compile({ addr: address }, [new CairoOption(CairoOptionVariant.None).toApiFormat()]);
    // Additional check: StarkNet addresses are typically 66 characters long (0x + 64 hex chars)
    // or shorter if leading zeros are omitted. Max length is 66.
    // Felt252 can be up to 252 bits, so hex can be up to 63 chars + 0x prefix.
    // Starknet.js `isAddress` or similar dedicated function would be ideal if available in future versions
    // For now, CallData.compile is a robust check.
    // Let's ensure it's a hex string and check length.
    if (!ethers.isHexString(address)) {
      return false;
    }
    // Length of a felt252 hex string can be up to 64 characters after '0x'.
    // Smallest is '0x0'.
    return address.length > 2 && address.length <= 66;
  } catch (error) {
    return false;
  }
}

/**
 * Formats a StarkNet address (felt252) into a bytes32 hex string for L1 contract calls.
 *
 * @param address The StarkNet address to format.
 * @returns The address formatted as a bytes32 hex string.
 * @throws If the address is invalid or cannot be formatted.
 */
export function formatStarkNetAddressForContract(address: string): string {
  if (!validateStarkNetAddress(address)) {
    throw new Error(`Invalid StarkNet address: ${address}`);
  }
  // StarkNet addresses (felt252) are already less than or equal to 32 bytes.
  // We need to pad them to ensure they are exactly 32 bytes.
  // ethers.utils.hexZeroPad expects a hex string.
  return ethers.hexZeroPad(address, 32);
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

    // Iterate through script chunks to find a potential StarkNet address.
    // A StarkNet address is a felt252, typically represented as a hex string.
    // We'll look for a data push (Buffer) that could be a valid address.
    for (const chunk of chunks) {
      if (Buffer.isBuffer(chunk)) {
        // Convert buffer to hex string, add '0x' prefix
        const potentialAddress = '0x' + chunk.toString('hex');
        if (validateStarkNetAddress(potentialAddress)) {
          // Ensure it's not too long for a felt (max 64 hex chars + 0x)
          // and not too short (e.g. 0x0 is valid but might be ambiguous without context)
          // validateStarkNetAddress already checks length implicitly via CallData.compile
          // but an explicit check on length of the buffer might be useful.
          // A felt252 is at most 32 bytes.
          if (chunk.length > 0 && chunk.length <= 32) {
             return potentialAddress;
          }
        }
      }
    }
    return null;
  } catch (error) {
    // Errors during decompilation or validation
    console.error("Error extracting address from Bitcoin script:", error);
    return null;
  }
} 