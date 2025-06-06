/**
 * SolanaChainHandler: Handles Solana-specific logic for cross-chain tBTC relayer.
 *
 * This class implements L2 setup, event listening, deposit finalization, and bridging for Solana.
 * It extends BaseChainHandler and integrates with Solana, Anchor, and Wormhole SDKs.
 *
 * Update this file to add, refactor, or clarify Solana-specific logic and contracts.
 */
import { Connection, Keypair, type Commitment, PublicKey } from '@solana/web3.js';
import { signSendWait, Wormhole } from '@wormhole-foundation/sdk';
import { getSolanaSignAndSendSigner } from '@wormhole-foundation/sdk-solana';
import type { Chain, ChainContext, TBTCBridge } from '@wormhole-foundation/sdk-connect';
import * as AllEthers from 'ethers';
import type { TransactionReceipt } from '@ethersproject/providers';
import { AnchorProvider, type Idl, Program, setProvider, Wallet } from '@coral-xyz/anchor';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes/index.js';

import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { SolanaChainConfig } from '../config/schemas/solana.chain.schema.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { type Deposit } from '../types/Deposit.type.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import wormholeGatewayIdl from '../target/idl/wormhole_gateway.json' assert { type: 'json' };
import { updateToAwaitingWormholeVAA, updateToBridgedDeposit } from '../utils/Deposits.js';
import { DepositStore } from '../utils/DepositStore.js';

const WORMHOLE_GATEWAY_PROGRAM_ID = new PublicKey('87MEvHZCXE3ML5rrmh5uX1FbShHmRXXS32xJDGbQ7h5t');
const TOKENS_TRANSFERRED_SIG = AllEthers.utils.id(
  'TokensTransferredWithPayload(uint256,bytes32,uint64)',
);
const DEFAULT_COMMITMENT_LEVEL: Commitment = 'confirmed';

// =====================
// SolanaChainHandler Class Definition
// =====================

export class SolanaChainHandler extends BaseChainHandler<SolanaChainConfig> {
  private connection?: Connection;
  private provider?: AnchorProvider;
  private wormholeGatewayProgram?: Program<Idl>;
  private wallet: Wallet;
  private ethereumWormholeContext: ChainContext<'Mainnet' | 'Testnet' | 'Devnet', Chain>;

  // =====================
  // Constructor & L2 Setup
  // =====================

  /**
   * Constructs a SolanaChainHandler for the given config.
   * @param config Solana chain configuration
   */
  constructor(config: SolanaChainConfig) {
    super(config);
    if (config.chainType !== CHAIN_TYPE.SOLANA) {
      throw new Error(`Incorrect chain type ${config.chainType} provided to SolanaChainHandler.`);
    }
  }

  /**
   * Sets up Solana connection, Anchor provider, and loads the Wormhole Gateway program.
   * Called by initializeChain() in Core.ts.
   */
  protected initializeL2() {
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

      const secretKeyBase64 = this.config.solanaSignerKeyBase;
      if (!secretKeyBase64) throw new Error('Missing solanaSignerKeyBase');

      const secretKeyBytes = new Uint8Array((secretKeyBase64 as string).split(',').map(Number));
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
    } catch (error: unknown) {
      logErrorContext(`Error initializing Solana L2 for ${this.config.chainName}`, error);
      throw error;
    }
  }

  // =====================
  // Event Listeners
  // =====================

  /**
   * Set up L2 event listeners. Not yet implemented for Solana.
   * Called by setupListeners() in BaseChainHandler (if !useEndpoint).
   */
  protected async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint) {
      logger.warn(`Solana L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`);
      return;
    }
    logger.warn(`Solana L2 Listener setup NOT YET IMPLEMENTED for ${this.config.chainName}.`);
  }

  // =====================
  // Block Queries
  // =====================

  /**
   * Get the latest Solana slot (block) for on-chain queries.
   * @returns The latest slot number, or 0 if unavailable.
   */
  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0; // Skip if using endpoint mode
    if (!this.connection) {
      logger.warn(`No Solana connection established. Returning 0.`);
      return 0;
    }
    try {
      return await this.connection.getSlot(DEFAULT_COMMITMENT_LEVEL);
    } catch (error: unknown) {
      logErrorContext('Error getting latest Solana slot', error);
      return 0;
    }
  }

  /**
   * Scan logs or transactions on Solana for missed deposits. Not yet implemented.
   * @param _options Options for past deposit checking (time window, latest block)
   */
  async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint) return; // no direct chain scanning
    logger.warn(`Solana checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`);
  }

  // =====================
  // Deposit Finalization
  // =====================

  /**
   * Finalize a deposit on Solana, parse Wormhole transferSequence, and update deposit status.
   * @param deposit The deposit object to finalize
   * @returns The transaction receipt if successful, or undefined
   */
  async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    const finalizedDepositReceipt = await super.finalizeDeposit(deposit);

    if (!finalizedDepositReceipt) {
      return undefined;
    }
    logger.info(`Finalizing deposit ${deposit.id} on Solana...`);

    const l1Receipt = finalizedDepositReceipt;
    if (!l1Receipt) {
      logger.warn(`No finalize receipt found for deposit ${deposit.id}; cannot parse logs.`);
      return undefined;
    }

    let transferSequence: string | null = null;
    try {
      const logs = l1Receipt.logs || [];

      for (const log of logs) {
        if (log.topics[0] === TOKENS_TRANSFERRED_SIG) {
          const parsedLog = this.l1BitcoinDepositor.interface.parseLog(log);
          const { transferSequence: seq } = parsedLog.args;
          transferSequence = seq.toString();
          break;
        }
      }
    } catch (error: unknown) {
      logErrorContext(`Error parsing L1 logs for deposit ${deposit.id}`, error);
    }

    if (!transferSequence) {
      logger.warn(`Could not find transferSequence in logs for deposit ${deposit.id}.`);
      return finalizedDepositReceipt;
    }

    await updateToAwaitingWormholeVAA(l1Receipt.transactionHash, deposit, transferSequence);
    logger.info(`Deposit ${deposit.id} now awaiting Wormhole VAA.`);
    return finalizedDepositReceipt;
  }

  // =====================
  // Bridging Logic
  // =====================

  /**
   * Bridge a Solana deposit using the Wormhole Gateway program.
   * @param deposit The deposit object to bridge
   */
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

    const secretKeyBase64 = this.config.solanaSignerKeyBase;
    if (!secretKeyBase64) throw new Error('Missing solanaSignerKeyBase');

    const signerSecretKeyBytes = new Uint8Array((secretKeyBase64 as string).split(',').map(Number));
    const signerKeypair = Keypair.fromSecretKey(signerSecretKeyBytes);
    const signerSecretKeyBase58 = bs58.encode(signerKeypair.secretKey);
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

      updateToBridgedDeposit(deposit, destinationTransactionIds[1].txid);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown bridging error';
      logger.warn(`Wormhole bridging not ready for deposit ${deposit.id}: ${reason}`);
    }
  }

  // =====================
  // Batch Processing
  // =====================

  /**
   * Process all deposits that need bridging via Wormhole. Not yet implemented.
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
}
