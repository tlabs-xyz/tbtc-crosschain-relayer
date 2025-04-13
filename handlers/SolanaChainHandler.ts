import { ethers } from 'ethers'; // For reading the 'transferSequence' from event logs
import { 
  AnchorProvider, 
  Idl, 
  Program, 
  setProvider, 
  Wallet, 
} from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { postVaaSolana, CONTRACTS, getEmitterAddressEth } from '@certusone/wormhole-sdk';

import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { LogMessage, LogWarning, LogError } from '../utils/Logs';
import { BaseChainHandler } from './BaseChainHandler';
import { Deposit } from '../types/Deposit.type';
import { DepositStatus } from '../types/DepositStatus.enum';

import wormholeGatewayIdl from '../target/idl/wormhole_gateway.json';
import { updateToAwaitingWormholeVAA, updateToBridgedDeposit } from '../utils/Deposits';
import { getAllJsonOperationsByStatus } from '../utils/JsonUtils';
import { getMintPDA, receiveTbtcIx } from '../utils/Wormhole';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { 
  EMITTER_CHAIN_ID, IS_MAINNET,
  WORMHOLE_API_URL,
  WORMHOLE_GATEWAY_PROGRAM_ID
} from '../utils/Constants';


export class SolanaChainHandler extends BaseChainHandler {
  private connection?: Connection;
  private provider?: AnchorProvider;
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
      this.connection = new Connection(this.config.l2Rpc, 'confirmed');

      const secretKeyBase64 = this.config.solanaKeyBase;
      if (!secretKeyBase64) throw new Error("Missing solanaKeyBase");
      const secretKeyBytes = new Uint8Array(secretKeyBase64.split(',').map(Number));
      const keypair = Keypair.fromSecretKey(secretKeyBytes);
      const wallet = new Wallet(keypair);

      this.provider = new AnchorProvider(
        this.connection,
        wallet,
        {}
      );

      setProvider(this.provider);

      this.wormholeGatewayProgram = new Program<Idl>(
        wormholeGatewayIdl as unknown as Idl,
        WORMHOLE_GATEWAY_PROGRAM_ID,
        this.provider
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
    if (!this.connection) {
      LogWarning(`No Solana connection established. Returning 0.`);
      return 0;
    }
    try {
      return await this.connection.getSlot('confirmed');
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
  
    if (!finalizedDeposit?.receipt) {
      return;
    }
    LogMessage(`Finalizing deposit ${deposit.id} on Solana...`);
  
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
    LogMessage(`Bridging deposit ${deposit.id} on Solana...`);

    if (!this.wormholeGatewayProgram) {
      LogWarning(`Wormhole Gateway program not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (!this.connection || !this.provider) {
      // Solana connection not initialized
      LogWarning(`Solana connection not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (deposit.status !== DepositStatus.AWAITING_WORMHOLE_VAA) return;
  
    const { transferSequence } = deposit.wormholeInfo || {};
    if (!transferSequence) return;
  
    LogMessage(`Attempting to fetch VAA for deposit ${deposit.id} seq=${transferSequence}`);
    const emitterAddressEth = getEmitterAddressEth(this.l1BitcoinDepositor.address);
  
    try {
      const signedVaaResponse = await fetch(
        `${WORMHOLE_API_URL}/v1/signed_vaa/${EMITTER_CHAIN_ID}/${emitterAddressEth}/${transferSequence}`
      );
      let vaaBytes = await signedVaaResponse.json();
      
      if (!signedVaaResponse.ok) {
       LogWarning(`VAA message is not yet signed by the guardians: ${signedVaaResponse.status}`);
        return;
      }
      // If no error thrown, we have the VAA.
      LogMessage(`VAA found for deposit ${deposit.id}. Posting to Solana...`);
      const NETWORK = IS_MAINNET ? 'MAINNET' : 'TESTNET';
      
      const WORMHOLE_CONTRACTS = CONTRACTS[NETWORK]["solana"];
      const CORE_BRIDGE_PID = new PublicKey(WORMHOLE_CONTRACTS.core);

      const vaaBytesStr = vaaBytes.vaaBytes;
      const vaaBuffer = Buffer.from(vaaBytesStr, "base64");

      LogMessage(`Posting VAA to Solana...`);

      const postVaaTxSig = await postVaaSolana(
        this.connection,
        this.provider.wallet.signTransaction.bind(this.provider.wallet),
        CORE_BRIDGE_PID,
        this.provider.wallet.publicKey,
        vaaBuffer
      );
      LogMessage(`Posted VAA on Solana (txSig=${postVaaTxSig[0]} and response=${postVaaTxSig[1]})`);
  
      const recipientPubkeyBytes = Buffer.from(deposit.receipt.extraData.slice(2), "hex");
      const recipientPubkey = new PublicKey(recipientPubkeyBytes);
      const recipientToken = getAssociatedTokenAddressSync(
        getMintPDA(),
        recipientPubkey
      );

      LogMessage(`Calling receiveTbtcIx...`);

      const txSig = await receiveTbtcIx(
        {
          payer: this.provider.wallet.publicKey,
          recipientToken,
          recipient: recipientPubkey,
        },
        vaaBuffer,
        this.wormholeGatewayProgram,
      )
  
      LogMessage(`Solana bridging success for deposit ${deposit.id}, txSig=${txSig}`);

      updateToBridgedDeposit(deposit, txSig);  
    } catch (error: any) {
      // Either the VAA isn't available yet, or some other bridging error occurred
      const reason = error.message || 'Unknown bridging error';
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
