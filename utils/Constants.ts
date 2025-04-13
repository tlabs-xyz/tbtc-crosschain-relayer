import { CHAIN_ID_ETH, CHAIN_ID_SEPOLIA } from "@certusone/wormhole-sdk";
import { PublicKey } from "@solana/web3.js";

export const TBTC_ADDRESS_BYTES_32 = Buffer.concat([
  Buffer.alloc(12), // 12 zero bytes
  Buffer.from("517f2982701695D4E52f1ECFBEf3ba31Df470161", "hex")
]); // sepolia address in bytes32

export const TBTC_PROGRAM_ID = new PublicKey(
  "Gj93RRt6QB7FjmyokAD5rcMAku7pq3Fk2Aa8y6nNbwsV"
);
export const WORMHOLE_GATEWAY_PROGRAM_ID = new PublicKey(
  "87MEvHZCXE3ML5rrmh5uX1FbShHmRXXS32xJDGbQ7h5t"
);

export const CORE_BRIDGE_PROGRAM_ID = new PublicKey(
  "Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o"
);
export const TOKEN_BRIDGE_PROGRAM_ID = new PublicKey(
  "B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE"
);

export const WORMHOLE_API_URL = process.env.IS_MAINNET === "true" ? "https://api.wormholescan.io" : "https://api.testnet.wormholescan.io";

export const IS_MAINNET = process.env.IS_MAINNET === "true";

export const EMITTER_CHAIN_ID = IS_MAINNET ? CHAIN_ID_ETH : CHAIN_ID_SEPOLIA;
