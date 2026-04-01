import { AnchorProvider, type Idl, Program, setProvider, Wallet } from '@coral-xyz/anchor';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes/index.js';
import type { TransactionReceipt } from '@ethersproject/providers';
import * as Sentry from '@sentry/node';
import { type Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { signSendWait, Wormhole } from '@wormhole-foundation/sdk';
import type { Chain, ChainContext, TBTCBridge } from '@wormhole-foundation/sdk-connect';
import { getSolanaSignAndSendSigner } from '@wormhole-foundation/sdk-solana';
import { ethers } from 'ethers';

import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { SolanaChainConfig } from '../config/schemas/solana.chain.schema.js';
import wormholeGatewayIdl from '../target/idl/wormhole_gateway.json' with { type: 'json' };
import type { Deposit } from '../types/Deposit.type.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { DepositStore } from '../utils/DepositStore.js';
import {
  updateToAwaitingWormholeVAA,
  updateToBridgedDeposit,
  updateToFinalizedAwaitingVAA,
} from '../utils/Deposits.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { BaseChainHandler, RECOVERY_DELAY_MS } from './BaseChainHandler.js';

const WORMHOLE_GATEWAY_PROGRAM_ID = new PublicKey('87MEvHZCXE3ML5rrmh5uX1FbShHmRXXS32xJDGbQ7h5t');
const TOKENS_TRANSFERRED_SIG = ethers.utils.id(
  'TokensTransferredWithPayload(uint256,bytes32,uint64)',
);
const DEFAULT_COMMITMENT_LEVEL: Commitment = 'confirmed';

export class SolanaChainHandler extends BaseChainHandler<SolanaChainConfig> {
  private connection?: Connection;
  private provider?: AnchorProvider;
  private wormholeGatewayProgram?: Program<Idl>;
  private wallet: Wallet;
  private ethereumWormholeContext: ChainContext<'Mainnet' | 'Testnet' | 'Devnet', Chain>;

  constructor(config: SolanaChainConfig) {
    super(config);
    logger.debug(`Constructing SolanaChainHandler for ${this.config.chainName}`);
    if (config.chainType !== CHAIN_TYPE.SOLANA) {
      throw new Error(`Incorrect chain type ${config.chainType} provided to SolanaChainHandler.`);
    }
  }

  /**
   * Called by `initializeChain()` in Core.ts
   * Sets up Solana connection, Anchor provider, and loads your Wormhole Gateway program.
   */
  protected override initializeL2() {
    logger.debug(`Initializing Solana L2 components for ${this.config.chainName}`);

    if (!this.config.l2Rpc) {
      logger.warn(
        `Solana L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`,
      );
      return;
    }

    try {
      this.connection = new Connection(this.config.l2Rpc, {
        commitment: 'confirmed',
        disableRetryOnRateLimit: true,
        wsEndpoint: this.config.l2WsRpc,
      });

      const base58PrivateKey = this.config.solanaPrivateKey;
      if (!base58PrivateKey) throw new Error('Missing solanaPrivateKey in config');

      const secretKeyBytes = bs58.decode(base58PrivateKey as string);
      const keypair = Keypair.fromSecretKey(secretKeyBytes);
      const wallet = new Wallet(keypair);
      this.wallet = wallet;

      this.provider = new AnchorProvider(this.connection, wallet, {});

      setProvider(this.provider);

      this.wormholeGatewayProgram = new Program<Idl>(
        wormholeGatewayIdl as unknown as Idl,
        WORMHOLE_GATEWAY_PROGRAM_ID,
        this.provider,
      );

      logger.info(
        `Solana L2/Anchor provider and Wormhole Gateway program loaded for ${this.config.chainName}`,
      );

      this.ethereumWormholeContext = this.wormhole.getChain('Ethereum' as Chain);
    } catch (error: any) {
      logErrorContext(`Error initializing Solana L2 for ${this.config.chainName}`, error);
      throw error;
    }
  }

  /**
   * Called by `setupListeners()` in BaseChainHandler (if !useEndpoint).
   * If you plan to do L2 event listening, implement it here.
   */
  protected override async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint) {
      logger.warn(`Solana L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`);
      return;
    }
    logger.warn(`Solana L2 Listener setup NOT YET IMPLEMENTED for ${this.config.chainName}.`);
  }

  /**
   * Get the latest Solana slot (block) if you need to do on-chain queries for missed deposits.
   */
  override async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0; // Skip if using endpoint mode
    if (!this.connection) {
      logger.warn(`No Solana connection established. Returning 0.`);
      return 0;
    }
    try {
      return await this.connection.getSlot(DEFAULT_COMMITMENT_LEVEL);
    } catch (error: any) {
      logErrorContext('Error getting latest Solana slot', error);
      return 0;
    }
  }

  /**
   * Example "checkForPastDeposits" if you wanted to scan logs or transactions on Solana.
   * Not yet implemented in this skeleton.
   */
  override async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint) return; // no direct chain scanning
    logger.warn(`Solana checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`);
  }

  /**
   * Override finalizeDeposit to:
   *  1) submit finalization tx on L1 (without persisting FINALIZED status)
   *  2) parse Wormhole transferSequence from receipt logs
   *  3) update deposit to AWAITING_WORMHOLE_VAA with transfer sequence
   *
   * Follows the same pattern as EVMChainHandler and SuiChainHandler:
   * call submitFinalizationTx() directly instead of super.finalizeDeposit()
   * to avoid marking FINALIZED before the transfer sequence is parsed.
   */
  override async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    if (!this.isDepositFinalizable(deposit)) return;

    const receipt = await this.submitFinalizationTx(deposit);

    if (receipt) {
      logger.info(`Processing Solana deposit finalization for ${deposit.id}...`);

      const { transferSequence, eventTxHash } = this.parseTransferSequenceFromReceipt(
        receipt,
        deposit.id,
      );

      if (transferSequence && eventTxHash) {
        await updateToFinalizedAwaitingVAA(deposit, receipt.transactionHash, transferSequence);
        logger.info(
          `Deposit ${deposit.id} now awaiting Wormhole VAA with sequence ${transferSequence}`,
        );
      } else {
        await this.handleMissingTransferSequence(deposit, receipt.transactionHash);
      }
    }

    return receipt;
  }

  public async bridgeSolanaDeposit(deposit: Deposit): Promise<void> {
    if (!this.connection || !this.provider || !this.wallet) {
      logger.warn(`Solana connection not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (!this.wormholeGatewayProgram) {
      logger.warn(`Wormhole Gateway program not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (deposit.status !== DepositStatus.AWAITING_WORMHOLE_VAA) return;

    const signerSecretKeyBase58 = this.config.solanaPrivateKey;
    if (!signerSecretKeyBase58)
      throw new Error('Missing solanaPrivateKey in config for Wormhole signer');

    const wormholeSolanaSigner = await getSolanaSignAndSendSigner(
      this.connection,
      signerSecretKeyBase58,
      {
        debug: true,
        priorityFee: {
          percentile: 0.5,
          percentileMultiple: 2,
          min: 1,
          max: 1000,
        },
        retries: 3,
        sendOpts: {
          skipPreflight: true,
        },
      },
    );
    const sender = Wormhole.parseAddress(
      wormholeSolanaSigner.chain(),
      wormholeSolanaSigner.address(),
    );

    const toChain = this.wormhole.getChain('Solana' as Chain);

    logger.info(`Bridging deposit ${deposit.id} on Solana...`);

    const [wormholeMessageId] = await this.ethereumWormholeContext.parseTransaction(
      deposit.wormholeInfo.txHash!,
    );

    if (!wormholeMessageId) {
      logger.warn(`No Wormhole message found for deposit ${deposit.id}`);
      return;
    }

    try {
      logger.info(`Attempting to fetch VAA for deposit ${deposit.id}`);
      const vaa = (await this.wormhole.getVaa(
        wormholeMessageId,
        'TBTCBridge:GatewayTransfer',
        60_000,
      )) as TBTCBridge.VAA;

      if (!vaa) {
        logger.warn(`VAA message is not yet signed by the guardians`);
        return;
      }

      logger.info(`VAA found for deposit ${deposit.id}. Posting VAA to Solana...`);

      const bridge = await toChain.getTBTCBridge();
      const unsignedTransactions = bridge.redeem(sender, vaa);

      const destinationTransactionIds = await signSendWait(
        toChain,
        unsignedTransactions,
        wormholeSolanaSigner,
      );
      logger.info(
        `Solana bridging success for deposit ${deposit.id}, txids=${destinationTransactionIds}`,
      );

      await updateToBridgedDeposit(deposit, destinationTransactionIds[1].txid, CHAIN_TYPE.SOLANA);
    } catch (error: any) {
      const reason = error.message || 'Unknown bridging error';
      const isPermanentRevert = error.message?.includes('Transaction failed:');

      if (isPermanentRevert) {
        logger.error(`Wormhole bridging permanently failed for deposit ${deposit.id}: ${reason}`, {
          depositId: deposit.id,
          transferSequence: deposit.wormholeInfo?.transferSequence,
          errorType: error.constructor.name,
          errorMessage: error.message,
        });
        Sentry.captureException(
          new Error(`receiveTbtc transaction reverted for deposit ${deposit.id}`),
          {
            extra: {
              depositId: deposit.id,
              chainName: this.config.chainName,
              transferSequence: deposit.wormholeInfo?.transferSequence,
              reason,
            },
          },
        );
      } else {
        logger.warn(`Wormhole bridging failed for deposit ${deposit.id}: ${reason}`, {
          depositId: deposit.id,
          transferSequence: deposit.wormholeInfo?.transferSequence,
          errorType: error.constructor.name,
          errorMessage: error.message,
          stack: error.stack,
        });
      }

      await DepositStore.update({
        ...deposit,
        error: isPermanentRevert ? 'receiveTbtc_reverted' : 'bridging_exception',
        dates: { ...deposit.dates, lastActivityAt: Date.now() },
      });
    }
  }

  /**
   * Process all deposits that are in the AWAITING_WORMHOLE_VAA status.
   * This function will attempt to bridge the deposits using the Wormhole protocol.
   */
  public async processWormholeBridging() {
    if (this.config.chainType !== CHAIN_TYPE.SOLANA) return; // Only for Solana chains

    const bridgingDeposits = await DepositStore.getByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA,
      this.config.chainName,
    );
    if (bridgingDeposits.length === 0) return;

    for (const deposit of bridgingDeposits) {
      if (!deposit.wormholeInfo || !deposit.wormholeInfo.transferSequence) {
        logger.warn(`Deposit ${deposit.id} is missing transferSequence. Skipping.`);
        continue;
      }
      await this.bridgeSolanaDeposit(deposit);
    }
  }

  /**
   * Re-attempts bridging for deposits stuck in AWAITING_WORMHOLE_VAA status.
   * Filters to deposits waiting longer than RECOVERY_DELAY_MS and excludes deposits
   * tagged with a permanent error (receiveTbtc_reverted). Transient errors
   * (bridging_exception) are retried after RECOVERY_DELAY_MS backoff via
   * lastActivityAt. FINALIZED deposits with transferSequence_not_found cannot be
   * auto-recovered — they are surfaced via a one-time Sentry alert.
   */
  public async recoverStuckFinalizedDeposits(): Promise<void> {
    const awaitingDeposits = await DepositStore.getByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA,
      this.config.chainName,
    );

    const now = Date.now();
    const stuckDeposits = awaitingDeposits.filter((deposit) => {
      if (deposit.error === 'receiveTbtc_reverted') return false;
      const awaitingSince =
        deposit.dates.awaitingWormholeVAAMessageSince ?? deposit.dates.finalizationAt;
      if (!awaitingSince) return false;
      return now - awaitingSince > RECOVERY_DELAY_MS;
    });

    for (const deposit of stuckDeposits) {
      try {
        logger.info(`Re-attempting bridging for AWAITING deposit ${deposit.id}`);
        await this.bridgeSolanaDeposit(deposit);
      } catch (error) {
        logErrorContext(`Error re-bridging deposit ${deposit.id}`, error);
      }
    }

    // Alert on FINALIZED deposits whose transferSequence was never parsed.
    // These cannot be auto-recovered; the Sentry alert prompts manual investigation.
    // Each deposit fires exactly one Sentry alert — the error tag is updated afterward
    // to prevent repeated alerts from exhausting Sentry quota.
    const finalizedDeposits = await DepositStore.getByStatus(
      DepositStatus.FINALIZED,
      this.config.chainName,
    );
    for (const deposit of finalizedDeposits) {
      if (deposit.error !== 'transferSequence_not_found') continue;
      if (!deposit.dates.finalizationAt) continue;
      if (now - deposit.dates.finalizationAt <= RECOVERY_DELAY_MS) continue;
      const msg = `Deposit ${deposit.id} is stuck in FINALIZED with transferSequence_not_found — manual intervention required`;
      logger.error(msg, { depositId: deposit.id, chainName: this.config.chainName });
      Sentry.captureException(new Error(msg), {
        extra: {
          depositId: deposit.id,
          chainName: this.config.chainName,
          finalizeTxHash: deposit.hashes?.eth?.finalizeTxHash,
          finalizationAt: deposit.dates.finalizationAt,
        },
      });
      await DepositStore.update({
        ...deposit,
        error: 'transferSequence_not_found_alerted',
        dates: { ...deposit.dates, lastActivityAt: Date.now() },
      });
    }
  }
}
