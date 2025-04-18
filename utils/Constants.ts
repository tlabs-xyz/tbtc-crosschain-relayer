import { CHAIN_ID_ETH, CHAIN_ID_SEPOLIA, CONTRACTS } from "@certusone/wormhole-sdk";
import { PublicKey } from "@solana/web3.js";

export const IS_MAINNET = process.env.IS_MAINNET === "true";

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

export const CORE_BRIDGE_PROGRAM_ID = IS_MAINNET 
  ?  new PublicKey(CONTRACTS.MAINNET.solana.core)
  : new PublicKey(CONTRACTS.DEVNET.solana.core);

export const TOKEN_BRIDGE_PROGRAM_ID = IS_MAINNET 
?  new PublicKey(CONTRACTS.MAINNET.solana.token_bridge)
: new PublicKey(CONTRACTS.DEVNET.solana.token_bridge);

export const TOKEN_BRIDGE_ETHEREUM_ADDRESS = IS_MAINNET 
  ? "0x3ee18B2214AFF97000D974cf647E7C347E8fa585" 
  : "0xDB5492265f6038831E89f495670FF909aDe94bd9"

export const WORMHOLE_API_URL = IS_MAINNET 
  ? "https://api.wormholescan.io"
  : "https://api.testnet.wormholescan.io";

export const EMITTER_CHAIN_ID = IS_MAINNET ? CHAIN_ID_ETH : CHAIN_ID_SEPOLIA;

export const MAX_VAA_UPLOAD_RETRIES_SOLANA = 5
