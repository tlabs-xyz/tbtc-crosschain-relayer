# Test Plan: `CleanupDeposits.ts`

This document outlines concrete test plans for `CleanupDeposits.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `CleanupDeposits.ts`

Assuming this service is responsible for periodic cleanup tasks related to deposits, such as archiving old finalized deposits, retrying certain failed deposits, or marking long-pending deposits as stale/failed.

**User Flows Involved (System/Maintenance Flows):**

- System archives old, successfully finalized deposits.
- System identifies and potentially retries deposits stuck in a retryable error state.
- System identifies and marks deposits as STALE or TIMED_OUT if they have been pending for too long without resolution.

**1. E2E Tests:**

- E2E testing for cleanup tasks is often challenging as it requires setting up specific long-term states. However, if the cleanup can be manually triggered via an API endpoint for testing purposes:
  - **Flow: Archive Old Finalized Deposits**
    - **Setup:** Create several finalized deposits with `createdAt` or `finalizationAt` dates older than the archive threshold.
    - **Test:** Trigger the cleanup process.
    - **Expected Outcome:** Old finalized deposits are marked as archived (or moved to a different table/store). Newer finalized deposits and pending deposits are untouched. Verify counts before and after.
  - **Flow: Mark Stale/Timed-Out Deposits**
    - **Setup:** Create deposits that are in a PENDING state for longer than the defined timeout threshold.
    - **Test:** Trigger the cleanup process.
    - **Expected Outcome:** These stale/timed-out deposits are moved to a FAILED or STALE status. Other deposits are unaffected.

**2. Integration Tests (Mocking `DepositStore`/Prisma, and potentially `Core.ts` or `ChainHandler` if cleanup involves re-evaluation or retries):**

- **Method: `archiveOldFinalizedDeposits()` (or equivalent)**

  - **Test (Happy Path - Deposits to Archive):**
    - Mock `DepositStore.findDepositsToArchive` (or Prisma query) to return a list of old, finalized deposits.
    - Mock `DepositStore.updateStatus` (or `markAsArchived`) for each.
    - **Expected Outcome:** `updateStatus` is called for each identified deposit. Correct logging occurs.
  - **Test (No Deposits to Archive):** Mock `DepositStore.findDepositsToArchive` to return an empty list.
    - **Expected Outcome:** No update calls are made. Process completes quietly or logs "No deposits to archive."
  - **Test (Error During Update):** Mock `DepositStore.updateStatus` to throw an error for one of the deposits.
    - **Expected Outcome:** The service handles the error gracefully (e.g., logs the specific failure, continues with other deposits if possible, or stops and reports the error).

- **Method: `identifyAndMarkStaleDeposits()` (or equivalent)**

  - **Test (Happy Path - Stale Deposits Found):**
    - Mock `DepositStore.findStalePendingDeposits` (or Prisma query) to return a list of deposits pending beyond the timeout.
    - Mock `DepositStore.updateStatus` to mark them as STALE/TIMED_OUT_FAILED.
    - **Expected Outcome:** `updateStatus` is called for each stale deposit. Correct logging.
  - **Test (No Stale Deposits):** Mock `DepositStore.findStalePendingDeposits` to return an empty list.
    - **Expected Outcome:** No update calls. Process completes quietly.

- **Method: `retryFailedDeposits()` (if this service handles retries)**
  - **Test (Retryable Deposits Found):**
    - Mock `DepositStore.findRetryableFailedDeposits` to return a list of deposits in a retryable error state.
    - Mock `Core.ts.retryDepositProcessing` (or a similar method in `Core.ts` or directly in `ChainHandler`) for each.
    - **Expected Outcome:** The retry processing method is called for each identified deposit. Status might be updated back to a PENDING state by the mocked retry method.
  - **Test (Retry Succeeded):** Mock `Core.ts.retryDepositProcessing` to indicate success.
    - **Expected Outcome:** Deposit status is updated to a PENDING state (e.g., PENDING_L2_CONFIRMATION).
  - **Test (Retry Failed Again):** Mock `Core.ts.retryDepositProcessing` to indicate failure, possibly decrementing a retry counter.
    - **Expected Outcome:** Deposit remains in a FAILED state, or moves to a more permanent FAILED state if max retries are exhausted. Retry counter is updated in `DepositStore`.

**3. Unit Tests:**

- **For specific, complex logic within `CleanupDeposits.ts` methods.** Examples:
  - If the logic for determining whether a deposit is "stale" or "retryable" involves complex conditions based on multiple deposit fields, status, error codes, and timestamps.
  - Any calculations for determining the next retry attempt time if a custom backoff strategy is implemented here.
  - Non-trivial logic for constructing specific Prisma queries if done dynamically within the service.

---
