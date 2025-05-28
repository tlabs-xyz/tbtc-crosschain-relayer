# Test Plan: `Core.ts`

This document outlines concrete test plans for `Core.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `Core.ts` (Assuming this is the core deposit processing service)

This service is likely responsible for orchestrating the deposit lifecycle, interacting with chain handlers, and updating deposit status in the database.

**User Flows Involved:**

- Processing a newly initiated deposit.
- Advancing a deposit through its lifecycle states (e.g., from QUEUED to INITIALIZED to PENDING_CONFIRMATION to FINALIZED/FAILED).
- Handling errors during deposit processing.

**1. E2E Tests (Covered by full lifecycle tests suggested in `analysis.md`):**

- These would inherently test the `Core.ts` service as part of the overall deposit flow. For example:
  - Successfully processing a deposit from L1 event to L2 finalization.
  - Handling an L2 transaction failure and marking the deposit as FAILED.

**2. Integration Tests (Mocking `ChainHandler` instances, `DepositStore`/Prisma, and other services like `WormholeVaaService` if used by `Core.ts`):**

- **Method: `processNewDeposit(depositData)` (or equivalent)**
  - **Test (Happy Path):** Provide valid `depositData`. Verify:
    - `DepositStore.saveDeposit` (or Prisma create) is called with initial status (e.g., QUEUED).
    - `ChainHandler.initiateL2Interaction` (or similar method for the target chain) is called with correct parameters derived from `depositData`.
    - If L2 interaction is successful (mocked response), verify `DepositStore.updateStatus` is called to move to INITIALIZED/PENDING_L2.
  - **Test (L2 Interaction Fails):** Mock `ChainHandler.initiateL2Interaction` to throw an error or return a failure. Verify:
    - `DepositStore.updateStatus` is called to move to a FAILED state (e.g., L2_SUBMISSION_FAILED).
    - Appropriate error logging occurs.
  - **Test (Duplicate Deposit):** If `DepositStore.saveDeposit` indicates a duplicate, verify the method handles this (e.g., logs, returns specific error/status).
- **Method: `checkForL2Confirmation(deposit)` (or equivalent)**
  - **Test (Confirmed):** Provide a deposit in PENDING_L2 state. Mock `ChainHandler.getL2TransactionConfirmation` to return confirmed. Verify:
    - `DepositStore.updateStatus` is called to move to FINALIZED.
    - Any post-finalization actions are triggered (e.g., notification, call to another service).
  - **Test (Not Yet Confirmed):** Mock `ChainHandler.getL2TransactionConfirmation` to return pending/not found. Verify:
    - Deposit status remains PENDING_L2 or moves to a specific "waiting for confirmation" state.
    - No premature finalization occurs.
  - **Test (Transaction Reverted on L2):** Mock `ChainHandler.getL2TransactionConfirmation` to indicate the L2 transaction was reverted. Verify:
    - `DepositStore.updateStatus` is called to move to FAILED (e.g., L2_REVERTED).
- **Method: `handleDepositError(deposit, error)` (or equivalent)**
  - **Test:** Simulate various error types passed to this method. Verify:
    - Deposit status is updated appropriately in `DepositStore`.
    - Retries are scheduled if the error is retryable (mock retry mechanism).
    - Critical errors lead to a terminal FAILED state.
    - Correct logging/alerting is performed.

**3. Unit Tests:**

- **For specific, complex logic within `Core.ts` methods if any.** Examples:
  - A complex state transition function that determines the next state based on multiple inputs and current state, if this logic is intricate.
  - Any non-trivial data mapping or transformation logic that occurs before calling a chain handler or updating the store, if it's complex enough not to be easily verified via integration tests.
  - Complex retry backoff calculations if implemented directly within `Core.ts`.
