# Test Plan: `L2RedemptionService.ts`

This document outlines concrete test plans for `L2RedemptionService.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `L2RedemptionService.ts`

Assuming this service handles the process of redeeming assets or fulfilling claims on an L2 network, possibly after an L1 action or a VAA verification.

**User Flows Involved:**

- User claims/redeems assets on L2.
- System processes a redemption request, potentially verifying prerequisites (like a VAA or an L1 event) and then interacting with an L2 contract.

**1. E2E Tests:**

- **Flow: Successful L2 Redemption**
  - **Test:** Simulate or trigger the prerequisite for a redemption (e.g., L1 action completed, VAA available). Then, call an API endpoint (if one exists for users to trigger redemption) or observe that the relayer picks up the redeemable state and processes it.
  - **Expected Outcome:** L2 redemption transaction is successfully submitted and confirmed. User's L2 balance updates, or a redemption record is marked as complete. Relevant events/logs are generated.
- **Flow: L2 Redemption - Prerequisites Not Met**
  - **Test:** Attempt to trigger redemption when prerequisites are not met (e.g., VAA is invalid/missing, L1 event not confirmed).
  - **Expected Outcome:** Redemption is rejected or fails. Clear error message or status update. No L2 transaction is attempted or an attempted one clearly fails validation.
- **Flow: L2 Redemption - L2 Contract Interaction Fails**
  - **Test:** Prerequisites are met, but the L2 smart contract interaction for redemption fails (e.g., contract reverts due to some on-chain condition, insufficient relayer L2 funds for gas).
  - **Expected Outcome:** Redemption attempt is marked as FAILED. System logs the error, potentially retries if applicable, or alerts.

**2. Integration Tests (Mocking L2 `ChainHandler`/Ethers.js, `DepositStore`/`RedemptionStore`/Prisma, and potentially `WormholeVaaService` or other prerequisite-checking services):**

- **Method: `processRedemption(redemptionRequestData)` (or equivalent)**
  - **Test (Happy Path):** Provide valid `redemptionRequestData`.
    - Mock prerequisite checks (e.g., `WormholeVaaService.verifyVaa` returns valid VAA, or `L1EventService.isEventConfirmed` returns true) to pass.
    - Mock L2 `ChainHandler.executeRedemptionContractCall` to return a successful transaction hash/receipt.
    - **Expected Outcome:** `RedemptionStore.updateStatus` (or Prisma) is called to mark redemption as PENDING_L2_CONFIRMATION, then FINALIZED. Relevant details (L2 tx hash) are stored.
  - **Test (Prerequisite Check Fails):** Mock a prerequisite check to fail.
    - **Expected Outcome:** No L2 contract call is made. Redemption status is updated to FAILED_PREREQUISITE (or similar). Error is logged.
  - **Test (L2 Contract Call Fails - Revert):** Mock `ChainHandler.executeRedemptionContractCall` to simulate a contract revert.
    - **Expected Outcome:** Redemption status is updated to FAILED_L2_REVERT. Error from chain is logged.
  - **Test (L2 Contract Call Fails - Network Error):** Mock `ChainHandler.executeRedemptionContractCall` to throw a network error.
    - **Expected Outcome:** Redemption status might go to a retryable error state or FAILED_NETWORK_ERROR. Retries might be attempted (if part of the service logic). Error is logged.
- **Method: `checkForRedemptionConfirmation(redemptionRecord)` (or similar, if redemptions also have a confirmation step)**
  - **Test (Confirmed):** Mock L2 `ChainHandler.getTransactionConfirmation` for the redemption L2 tx to return confirmed.
    - **Expected Outcome:** `RedemptionStore.updateStatus` to FINALIZED.
  - **Test (Not Yet Confirmed):** Mock confirmation as pending.
    - **Expected Outcome:** Status remains PENDING_L2_CONFIRMATION.
  - **Test (Transaction Reverted/Failed after being sent):** Mock confirmation to indicate failure.
    - **Expected Outcome:** Status updated to FAILED_L2_REVERT (or similar).

**3. Unit Tests:**

- **For specific, complex logic within `L2RedemptionService.ts` methods.** Examples:
  - If there's intricate logic for constructing the L2 transaction payload for different types of redemptions.
  - Complex validation rules for `redemptionRequestData` beyond simple presence checks.
  - Any non-trivial logic for determining if a redemption is retryable based on the type of error encountered.
