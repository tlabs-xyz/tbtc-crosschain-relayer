import { BigNumber, ethers } from "ethers";
import cron from "node-cron";
import { NonceManager } from "@ethersproject/experimental";

import { L1BitcoinDepositorABI } from "../interfaces/L1BitcoinDepositor";
import { L2BitcoinDepositorABI } from "../interfaces/L2BitcoinDepositor";
import { getJsonById, writeNewJsonDeposit } from "../utils/JsonUtils";
import { createDeposit } from "../utils/Deposits";
import { Deposit } from "../types/Deposit.type";
import { LogMessage } from "../utils/Logs";
import { TBTCVaultABI } from "../interfaces/TBTCVault";
import { cleanFinalizedDeposits, cleanQueuedDeposits } from "./CleanupDeposits";
import { attemptToInitializeDeposit, initializeDeposits } from "./InitializeDeposits";
import { attemptToFinalizeDeposit, finalizeDeposits } from "./FinalizeDeposits";
import { checkForPastDeposits } from "./CheckForPastDeposits";

// ---------------------------------------------------------------
// Environment Variables
// ---------------------------------------------------------------
const L2_RPC: string = process.env.L2_RPC || "";
const L1_RPC: string = process.env.L1_RPC || "";
const L1BitcoinDepositor_Address: string = process.env.L1BitcoinDepositor || "";
const L2BitcoinDepositor_Address: string = process.env.L2BitcoinDepositor || "";
const TBTCVaultAddress: string = process.env.TBTCVault || "";
const privateKey: string = process.env.PRIVATE_KEY || "";

export const TIME_TO_RETRY = 1000 * 60 * 5; // 5 minutes

// ---------------------------------------------------------------
// Providers
// ---------------------------------------------------------------
export const providerL2: ethers.providers.JsonRpcProvider = new ethers.providers.JsonRpcProvider(L2_RPC);
export const providerL1: ethers.providers.JsonRpcProvider = new ethers.providers.JsonRpcProvider(L1_RPC);

// ---------------------------------------------------------------
// Signers
// ---------------------------------------------------------------
export const signerL2: ethers.Wallet = new ethers.Wallet(privateKey, providerL2);
export const signerL1: ethers.Wallet = new ethers.Wallet(privateKey, providerL1);

//NonceManager Wallets
export const nonceManagerL2 = new NonceManager(signerL2);
export const nonceManagerL1 = new NonceManager(signerL1);

// ---------------------------------------------------------------
// Contracts for signing transactions
// ---------------------------------------------------------------
export const L1BitcoinDepositor: ethers.Contract = new ethers.Contract(
	L1BitcoinDepositor_Address,
	L1BitcoinDepositorABI,
	nonceManagerL1
);

export const L2BitcoinDepositor: ethers.Contract = new ethers.Contract(
	L2BitcoinDepositor_Address,
	L2BitcoinDepositorABI,
	nonceManagerL2
);

export const TBTCVault: ethers.Contract = new ethers.Contract(TBTCVaultAddress, TBTCVaultABI, signerL1);


// ---------------------------------------------------------------
// Contracts for event listening
// ---------------------------------------------------------------
const L1BitcoinDepositorProvider = new ethers.Contract(
    L1BitcoinDepositor_Address,
    L1BitcoinDepositorABI,
    providerL1
  );
  
const L2BitcoinDepositorProvider = new ethers.Contract(
    L2BitcoinDepositor_Address,
    L2BitcoinDepositorABI,
    providerL2
);
  
const TBTCVaultProvider = new ethers.Contract(TBTCVaultAddress, TBTCVaultABI, providerL1);

// ---------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------

/**
 * @name startCronJobs
 * @description Starts the cron jobs for finalizing and initializing deposits.
 */

export const startCronJobs = () => {
    // CRONJOBS
    LogMessage("Starting cron job setup...");

    // Every minute
    cron.schedule("* * * * *", async () => {
        await finalizeDeposits();
        await initializeDeposits();
    });

    // Every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
        const latestBlock = await providerL2.getBlock("latest");
        await checkForPastDeposits({ pastTimeInMinutes: 5 , latestBlock: latestBlock.number});
    });

    // Every 10 minutes
    cron.schedule("*/10 * * * *", async () => {
        await cleanQueuedDeposits();
        await cleanFinalizedDeposits();
    });

    LogMessage("Cron job setup complete.");
};


/**
 * @name createEventListeners
 * @description Sets up listeners for deposit initialization and finalization events.
 */
export const createEventListeners = () => {
	LogMessage("Setting up event listeners...");

	L2BitcoinDepositorProvider.on("DepositInitialized", async (fundingTx, reveal, l2DepositOwner, l2Sender) => {
		try {
			LogMessage(`Received DepositInitialized event for Tx: ${fundingTx}`);
			const deposit: Deposit = createDeposit(fundingTx, reveal, l2DepositOwner, l2Sender);
			writeNewJsonDeposit(fundingTx, reveal, l2DepositOwner, l2Sender);
			LogMessage(`Initializing deposit | Id: ${deposit.id}`);
			await attemptToInitializeDeposit(deposit);
		} catch (error) {
			LogMessage(`Error in DepositInitialized handler: ${error}`);
		}
	});

	TBTCVaultProvider.on("OptimisticMintingFinalized", (minter, depositKey, depositor, optimisticMintingDebt) => {
		try {
			const BigDepositKey = BigNumber.from(depositKey);
			const deposit: Deposit | null = getJsonById(BigDepositKey.toString());
			if (deposit) attemptToFinalizeDeposit(deposit);
		} catch (error) {
			LogMessage(`Error in the OptimisticMintingFinalized handler: ${error}`);
		}
	});

	LogMessage("Event listeners setup complete.");
};

// ---------------------------------------------------------------
