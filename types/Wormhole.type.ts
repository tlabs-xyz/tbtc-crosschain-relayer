import { PublicKey } from "@solana/web3.js";

export type ReceiveTbtcContext = {
  payer: PublicKey;
  custodian?: PublicKey;
  postedVaa?: PublicKey;
  tokenBridgeClaim?: PublicKey;
  wrappedTbtcToken?: PublicKey;
  wrappedTbtcMint?: PublicKey;
  tbtcMint?: PublicKey;
  recipientToken: PublicKey;
  recipient: PublicKey;
  recipientWrappedToken?: PublicKey;
  tbtcConfig?: PublicKey;
  tbtcMinterInfo?: PublicKey;
  tokenBridgeConfig?: PublicKey;
  tokenBridgeRegisteredEmitter?: PublicKey;
  //tokenBridgeRedeemer?: PublicKey;
  tokenBridgeWrappedAsset?: PublicKey;
  tokenBridgeMintAuthority?: PublicKey;
  rent?: PublicKey;
  tbtcProgram?: PublicKey;
  tokenBridgeProgram?: PublicKey;
  coreBridgeProgram?: PublicKey;
};
