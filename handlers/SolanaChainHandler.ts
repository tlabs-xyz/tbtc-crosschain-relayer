import { ethers } from 'ethers'; // For reading the 'transferSequence' from event logs
import { 
  AnchorProvider, 
  Idl, 
  Program, 
  Wallet, 
} from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { parseVaa, getSignedVAAWithRetry, postVaaSolana, CHAIN_ID_ETH, CONTRACTS } from '@certusone/wormhole-sdk';

import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { LogMessage, LogWarning, LogError } from '../utils/Logs';
import { BaseChainHandler } from './BaseChainHandler';
import { Deposit } from '../types/Deposit.type';
import { DepositStatus } from '../types/DepositStatus.enum';

import wormholeGatewayIdl from '../idl/wormhole_gateway.json';
import { updateToAwaitingWormholeVAA, updateToBridgedDeposit } from '../utils/Deposits';
import { getAllJsonOperationsByStatus } from '../utils/JsonUtils';

const RPC_HOSTS = [
  'https://api.testnet.wormholescan.io/api/v1/',  // Testnet RPC
  'https://api.wormholescan.io/api/v1/', // Mainnet RPC
];

export class SolanaChainHandler extends BaseChainHandler {
  private solanaConnection?: Connection;
  private anchorProvider?: AnchorProvider;
  private wormholeGatewayProgram?: Program<Idl>;

  constructor(config: ChainConfig) {
    super(config);
    LogMessage(`Constructing SolanaChainHandler for ${this.config.chainName}`);
    if (config.chainType !== ChainType.SOLANA) {
      throw new Error(
        `Incorrect chain type ${config.chainType} provided to SolanaChainHandler.`
      );
    }
  }

  /**
   * Called by `initializeChain()` in Core.ts
   * Sets up Solana connection, Anchor provider, and loads your Wormhole Gateway program.
   */
  protected async initializeL2(): Promise<void> {
    LogMessage(`Initializing Solana L2 components for ${this.config.chainName}`);

    if (!this.config.l2Rpc) {
      LogWarning(
        `Solana L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`
      );
      return;
    }

    try {
      this.solanaConnection = new Connection(this.config.l2Rpc, 'confirmed');

      const secretKeyBase64 = this.config.solanaKeyBase;
      if (!secretKeyBase64) throw new Error("Missing solanaKeyBase");
      const secretKeyBytes = Buffer.from(secretKeyBase64, "base64");
      const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyBytes));
      const wallet = new Wallet(keypair);
      this.anchorProvider = new AnchorProvider(
        this.solanaConnection,
        wallet,
        AnchorProvider.defaultOptions()
      );

      this.wormholeGatewayProgram = new Program<Idl>(
        wormholeGatewayIdl as unknown as Idl,
        this.anchorProvider,
      );

      LogMessage(
        `Solana L2/Anchor provider and Wormhole Gateway program loaded for ${this.config.chainName}`
      );
    } catch (error: any) {
      LogError(`Error initializing Solana L2 for ${this.config.chainName}`, error);
      throw error;
    }
  }

  /**
   * Called by `setupListeners()` in BaseChainHandler (if !useEndpoint).
   * If you plan to do L2 event listening, implement it here.
   */
  protected async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint) {
      LogMessage(
        `Solana L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`
      );
      return;
    }
    LogWarning(
      `Solana L2 Listener setup NOT YET IMPLEMENTED for ${this.config.chainName}.`
    );
  }

  /**
   * Get the latest Solana slot (block) if you need to do on-chain queries for missed deposits.
   */
  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0; // Skip if using endpoint mode
    if (!this.solanaConnection) {
      LogWarning(`No Solana connection established. Returning 0.`);
      return 0;
    }
    try {
      return await this.solanaConnection.getSlot('confirmed');
    } catch (error: any) {
      LogError('Error getting latest Solana slot', error);
      return 0;
    }
  }

  /**
   * Example "checkForPastDeposits" if you wanted to scan logs or transactions on Solana.
   * Not yet implemented in this skeleton.
   */
  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint) return; // no direct chain scanning
    LogWarning(
      `Solana checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`
    );
  }

  /**
   * Override finalizeDeposit to:
   *  1) finalize on L1 (super call)
   *  2) parse Wormhole transferSequence from logs
   *  3) update deposit to AWAITING_WORMHOLE_VAA
   */
  async finalizeDeposit(deposit: Deposit): Promise<void> {
    const finalizedDeposit = await super.finalizeDeposit(deposit);
  
    if (deposit.status !== DepositStatus.FINALIZED || !finalizedDeposit?.receipt) {
      return;
    }
  
    const l1Receipt = finalizedDeposit.receipt;
    if (!l1Receipt) {
      LogWarning(
        `No finalize receipt found for deposit ${deposit.id}; cannot parse logs.`
      );
      return;
    }
  
    const TOKENS_TRANSFERRED_SIG = ethers.utils.id(
      'TokensTransferredWithPayload(uint256,bytes32,uint64)'
    );
    
    let transferSequence: string | null = null;
    try {
      const logs = l1Receipt.logs || [];
  
      for (const log of logs) {
        if (log.topics[0] === TOKENS_TRANSFERRED_SIG) {
          const parsedLog = this.l1BitcoinDepositor.interface.parseLog(log);
          const { amount, receiver, transferSequence: seq } = parsedLog.args;
          transferSequence = seq.toString();
          break;
        }
      }
    } catch (error: any) {
      LogError(`Error parsing L1 logs for deposit ${deposit.id}`, error);
    }
  
    if (!transferSequence) {
      LogWarning(
        `Could not find transferSequence in logs for deposit ${deposit.id}.`
      );
      return;
    }

    await updateToAwaitingWormholeVAA(deposit, transferSequence);  
    LogMessage(`Deposit ${deposit.id} now awaiting Wormhole VAA.`);
  }

  public async bridgeSolanaDeposit(deposit: Deposit): Promise<void> {
    if (!this.wormholeGatewayProgram) {
      LogWarning(`Wormhole Gateway program not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (!this.solanaConnection || !this.anchorProvider) {
      // Solana connection not initialized
      LogWarning(`Solana connection not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (deposit.status !== DepositStatus.AWAITING_WORMHOLE_VAA) return;
  
    const { transferSequence } = deposit.wormholeInfo || {};
    if (!transferSequence) return;
  
    LogMessage(`Attempting to fetch VAA for deposit ${deposit.id} seq=${transferSequence}`);
  
    try {
      const { vaaBytes } = await getSignedVAAWithRetry(
        RPC_HOSTS,
        CHAIN_ID_ETH,
        this.l1BitcoinDepositor.address,
        transferSequence,
        {
          maxAttempts: 20,
          retryDelayMs: 60000,         // Wait 60s between attempts
        },
      );
      // If no error thrown, we have the VAA.
      LogMessage(`VAA found for deposit ${deposit.id}. Posting to Solana...`);
  
      const isMainnet = this.l1BitcoinDepositorProvider.network.chainId === 1;
      const NETWORK = isMainnet ? 'MAINNET' : 'TESTNET';
      
      const WORMHOLE_CONTRACTS = CONTRACTS[NETWORK]["solana"];
      const CORE_BRIDGE_PID = new PublicKey(WORMHOLE_CONTRACTS.core);

      const vaaBuffer = Buffer.from(vaaBytes);

      const postVaaTxSig = await postVaaSolana(
        this.solanaConnection,
        this.anchorProvider.wallet.signTransaction.bind(this.anchorProvider!.wallet),
        CORE_BRIDGE_PID,
        this.anchorProvider.wallet.publicKey,
        vaaBuffer
      );
      LogMessage(`Posted VAA on Solana (txSig=${postVaaTxSig}). Now calling receive_tbtc.`);
  
      const parsedVaa = parseVaa(vaaBytes);
      const messageHash = parsedVaa.hash; // Buffer or Uint8Array
  
      const txSig = await this.wormholeGatewayProgram.methods
        .receiveTbtc([...messageHash]) 
        .accounts({})
        .rpc();
  
      LogMessage(`Solana bridging success for deposit ${deposit.id}, txSig=${txSig}`);

      updateToBridgedDeposit(deposit, txSig);  
    } catch (err: any) {
      // Either the VAA isn't available yet, or some other bridging error occurred
      const reason = err.message || 'Unknown bridging error';
      LogWarning(`Wormhole bridging not ready for deposit ${deposit.id}: ${reason}`);
    }
  }

  /**
   * Process all deposits that are in the AWAITING_WORMHOLE_VAA status.
   * This function will attempt to bridge the deposits using the Wormhole protocol.
   */
  public async processWormholeBridging() {
    const bridgingDeposits = await getAllJsonOperationsByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA
    );
    if (bridgingDeposits.length === 0) return;

    for (const deposit of bridgingDeposits) {
      if (!deposit.wormholeInfo || !deposit.wormholeInfo.transferSequence) {
        LogWarning(
          `Deposit ${deposit.id} is missing transferSequence. Skipping.`
        );
        continue;
      }

      await this.bridgeSolanaDeposit(deposit); 
    }
  }
}
