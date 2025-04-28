import { toChainId, type TBTCBridge } from '@wormhole-foundation/sdk-connect';
import { PublicKey, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { ReceiveTbtcContext } from "../types/Wormhole.type";
import * as tokenBridge from "@certusone/wormhole-sdk/lib/cjs/solana/tokenBridge";
import { utils as coreUtils } from '@wormhole-foundation/sdk-solana-core';
import { Idl, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { 
  CORE_BRIDGE_PROGRAM_ID,
  TBTC_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  WORMHOLE_GATEWAY_PROGRAM_ID
} from "./Constants";

export function getCustodianPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("redeemer")],
    new PublicKey(WORMHOLE_GATEWAY_PROGRAM_ID)
  )[0];
}

export function getCoreMessagePDA(sequence: bigint): PublicKey {
  const encodedSequence = Buffer.alloc(8);
  encodedSequence.writeBigUInt64LE(sequence);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("msg"), encodedSequence],
    WORMHOLE_GATEWAY_PROGRAM_ID
  )[0];
}

export function getGatewayInfoPDA(targetChain: number): PublicKey {
  const encodedChain = Buffer.alloc(2);
  encodedChain.writeUInt16LE(targetChain);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("gateway-info"), encodedChain],
    WORMHOLE_GATEWAY_PROGRAM_ID
  )[0];
}

export function getWrappedTbtcTokenPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("wrapped-token")],
    WORMHOLE_GATEWAY_PROGRAM_ID
  )[0];
}

export function getTokenBridgeSenderPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sender")],
    WORMHOLE_GATEWAY_PROGRAM_ID
  )[0];
}

export function getTokenBridgeRedeemerPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("redeemer")],
    WORMHOLE_GATEWAY_PROGRAM_ID
  )[0];
}

export function getConfigPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    TBTC_PROGRAM_ID
  )[0];
}

export function getMintPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tbtc-mint")],
    TBTC_PROGRAM_ID
  )[0];
}

export function getMinterInfoPDA(minter: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("minter-info"), minter.toBuffer()],
    TBTC_PROGRAM_ID
  )[0];
}

export function getGuardianInfoPDA(guardian: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("guardian-info"), guardian.toBuffer()],
    TBTC_PROGRAM_ID
  )[0];
}

export function getGuardiansPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("guardians")],
    TBTC_PROGRAM_ID
  )[0];
}

export function getMintersPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("minters")],
    TBTC_PROGRAM_ID
  )[0];
}

export async function receiveTbtcIx(
  accounts: ReceiveTbtcContext,
  vaa: TBTCBridge.VAA,
  program: Program<Idl>,
): Promise<TransactionInstruction> {
  let {
    payer,
    custodian,
    postedVaa,
    tokenBridgeClaim,
    wrappedTbtcToken,
    wrappedTbtcMint,
    tbtcMint,
    recipientToken,
    recipient,
    recipientWrappedToken,
    tbtcConfig,
    tbtcMinterInfo,
    tokenBridgeConfig,
    tokenBridgeRegisteredEmitter,
    tokenBridgeWrappedAsset,
    tokenBridgeMintAuthority,
    rent,
    tbtcProgram,
    tokenBridgeProgram,
    coreBridgeProgram,
  } = accounts;

  if (custodian === undefined) {
    custodian = getCustodianPDA();
  }

  const custodianData = await program.account.custodian.fetch(custodian);

  if (postedVaa === undefined) {
    postedVaa = coreUtils.derivePostedVaaKey(
      CORE_BRIDGE_PROGRAM_ID,
      Buffer.from(vaa.hash)
    );
  }

  if (tokenBridgeClaim === undefined) {
    tokenBridgeClaim = coreUtils.deriveClaimKey(
      TOKEN_BRIDGE_PROGRAM_ID,
      vaa.emitterAddress.toUint8Array(),
      toChainId(vaa.emitterChain),
      vaa.sequence
    );
  }

  if (wrappedTbtcToken === undefined) {
    wrappedTbtcToken = new PublicKey(
      custodianData.wrappedTbtcToken as string
    );
  }

  if (wrappedTbtcMint === undefined) {
    wrappedTbtcMint = new PublicKey(
      custodianData.wrappedTbtcMint as string
    );
  }

  if (tbtcMint === undefined) {
    tbtcMint = new PublicKey(custodianData.tbtcMint as string);
  }

  if (recipientWrappedToken == undefined) {
    recipientWrappedToken = getAssociatedTokenAddressSync(
      wrappedTbtcMint,
      recipient
    );
  }

  if (tbtcConfig === undefined) {
    tbtcConfig = getConfigPDA();
  }

  if (tbtcMinterInfo === undefined) {
    tbtcMinterInfo = getMinterInfoPDA(custodian);
  }

  if (tokenBridgeConfig === undefined) {
    tokenBridgeConfig = tokenBridge.deriveTokenBridgeConfigKey(
      TOKEN_BRIDGE_PROGRAM_ID
    );
  }

  if (tokenBridgeRegisteredEmitter === undefined) {
    tokenBridgeRegisteredEmitter = tokenBridge.deriveEndpointKey(
      TOKEN_BRIDGE_PROGRAM_ID,
      toChainId(vaa.emitterChain),
      vaa.emitterAddress.toUint8Array(),
    );
  }

  if (tokenBridgeWrappedAsset === undefined) {
    tokenBridgeWrappedAsset = tokenBridge.deriveWrappedMetaKey(
      TOKEN_BRIDGE_PROGRAM_ID,
      wrappedTbtcMint
    );
  }

  if (tokenBridgeMintAuthority === undefined) {
    tokenBridgeMintAuthority = tokenBridge.deriveMintAuthorityKey(
      TOKEN_BRIDGE_PROGRAM_ID
    );
  }

  if (rent === undefined) {
    rent = SYSVAR_RENT_PUBKEY;
  }

  if (tbtcProgram === undefined) {
    tbtcProgram = TBTC_PROGRAM_ID;
  }

  if (tokenBridgeProgram === undefined) {
    tokenBridgeProgram = TOKEN_BRIDGE_PROGRAM_ID;
  }

  if (coreBridgeProgram === undefined) {
    coreBridgeProgram = CORE_BRIDGE_PROGRAM_ID;
  }

  return await program.methods
    .receiveTbtc([...vaa.hash])
    .accounts({
      payer,
      custodian,
      postedVaa,
      tokenBridgeClaim,
      wrappedTbtcToken,
      wrappedTbtcMint,
      tbtcMint,
      recipientToken,
      recipient,
      recipientWrappedToken,
      tbtcConfig,
      tbtcMinterInfo,
      tokenBridgeConfig,
      tokenBridgeRegisteredEmitter,
      tokenBridgeWrappedAsset,
      tokenBridgeMintAuthority,
      rent,
      tbtcProgram,
      tokenBridgeProgram,
      coreBridgeProgram,
    })
    .instruction();
}
