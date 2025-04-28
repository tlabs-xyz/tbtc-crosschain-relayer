import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import type { Chain, Network } from "@wormhole-foundation/sdk-base";
import type {
  ChainContext,
  SignAndSendSigner,
  Signer,
  TransactionId,
  TxHash,
  UnsignedTransaction,
  VAA,
} from "@wormhole-foundation/sdk-definitions";
import {
  getSolanaSigner,
  SolanaAddress,
  SolanaPlatform,
  SolanaTransaction,
  SolanaUnsignedTransaction,
  type SolanaChains,
} from '@wormhole-foundation/sdk-solana';
import { SolanaWormholeCore } from "@wormhole-foundation/sdk-solana-core";
import { isSignAndSendSigner, isSigner } from "@wormhole-foundation/sdk-definitions";
import { CORE_BRIDGE_PROGRAM_ID } from "./Constants";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { createVerifySignaturesInstructions } from "./CreateVerifySignaturesInstructions";
import { createPostVaaInstruction } from "./PostVaa";
import { CHAIN_NAME, NETWORK } from "../types/ChainConfig.type";

type SignSend<N extends Network, C extends Chain> = (
  txns: UnsignedTransaction<N, C>[],
) => Promise<TxHash[]>;

export async function signSendWait<N extends Network, C extends Chain>(
  chain: ChainContext<N, C>,
  xfer: Array<UnsignedTransaction<N, C>>,
  signer: Signer<N, C>,
): Promise<TransactionId[]> {
  if (!isSigner(signer)) throw new Error("Invalid signer, not SignAndSendSigner or SignOnlySigner");

  const signSend = async (txns: UnsignedTransaction<N, C>[]): Promise<TxHash[]> =>
    isSignAndSendSigner(signer)
      ? signer.signAndSend(txns)
      : chain.sendWait(await signer.sign(txns));

  const txHashes = await ssw(xfer, signSend);
  return txHashes.map((txid) => ({ chain: chain.chain, txid }));
}

async function ssw<N extends Network, C extends Chain>(
  xfer: Array<UnsignedTransaction<N, C>>,
  signSend: SignSend<N, C>,
): Promise<TxHash[]> {
  const txids: TxHash[] = [];
  let txbuff: UnsignedTransaction<N, C>[] = [];
  for await (const tx of xfer) {
    // buffer transactions as long as they are
    // marked as parallelizable
    if (tx.parallelizable) {
      txbuff.push(tx);
    } else {
      // if we find one is not parallelizable
      // flush the buffer then sign and send the
      // current tx
      if (txbuff.length > 0) {
        txids.push(...(await signSend(txbuff)));
        txbuff = [];
      }
      // Note: it may be possible to group this tx with
      // those in the buffer if there are any but
      // the parallelizable flag alone is not enough to signal
      // if this is safe
      txids.push(...(await signSend([tx])));
    }
  }

  if (txbuff.length > 0) {
    txids.push(...(await signSend(txbuff)));
  }

  return txids;
}

export async function postVaa(
  sender: PublicKey,
  vaa: VAA,
  connection: Connection,
  network: NETWORK,
) {
  const postedVaaAddress = derivePostedVaaKey(
    CORE_BRIDGE_PROGRAM_ID,
    Buffer.from(vaa.hash),
  );

  // no need to do anything else, this vaa is posted
  const isPosted = await connection.getAccountInfo(postedVaaAddress);
  if (isPosted) return;

  const senderAddr = new SolanaAddress(sender).unwrap();
  const signatureSet = Keypair.generate();

  const verifySignaturesInstructions =
    await createVerifySignaturesInstructions(
      connection,
      CORE_BRIDGE_PROGRAM_ID,
      senderAddr,
      vaa,
      signatureSet.publicKey,
    );

  // Create a new transaction for every 2 instructions
  for (let i = 0; i < verifySignaturesInstructions.length; i += 2) {
    const verifySigTx = new Transaction().add(
      ...verifySignaturesInstructions.slice(i, i + 2),
    );
    verifySigTx.feePayer = senderAddr;
    return new SolanaUnsignedTransaction(
      { transaction: verifySigTx, signers: [signatureSet] },
      network,
      CHAIN_NAME.SOLANA,
      "TBTCBridge.Send",
      true,
    );
  }

  // Finally create the VAA posting transaction
  const postVaaTx = new Transaction().add(
    createPostVaaInstruction(
      connection,
      CORE_BRIDGE_PROGRAM_ID,
      senderAddr,
      vaa,
      signatureSet.publicKey,
    ),
  );
  postVaaTx.feePayer = senderAddr;

  return new SolanaUnsignedTransaction(
    { transaction: postVaaTx },
    network,
    CHAIN_NAME.SOLANA,
    "TBTCBridge.Send",
    true,
  );
}
