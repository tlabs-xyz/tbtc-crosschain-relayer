# Test Plan: `WormholeVaaService.ts`

This document outlines concrete test plans for `WormholeVaaService.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `WormholeVaaService.ts`

This service is responsible for fetching and verifying Wormhole VAAs, a critical step in cross-chain operations that use Wormhole.

**User Flows Involved:**

- Part of any user flow that requires attestation via a Wormhole VAA (e.g., finalizing a deposit that was bridged via Wormhole, processing a Wormhole-based message).

**1. E2E Tests:**

- E2E tests for user flows that _utilize_ Wormhole (e.g., a full deposit lifecycle that involves a Wormhole bridge step) would inherently test the successful integration of `WormholeVaaService.ts`. If the VAA processing fails within this service, the E2E test for that user flow should fail.
- **Specific E2E Scenario (if a direct trigger exists or can be simulated):**
  - If there's an admin endpoint or a mechanism to re-process a VAA or manually input L2 transaction details to fetch a VAA, an E2E test could target this to ensure the service works end-to-end with a real (testnet) Wormhole Guardian network and RPCs.

**2. Integration Tests (Mocking Wormhole SDK, Ethers.js for L2 RPC calls, and Logger):**
_(The existing `tests/integration/services/WormholeVaaService.test.ts` already provides a very good foundation for this. The plan here is to ensure it aligns with the user flow focus and covers key positive/negative paths thoroughly.)_

- **Method: `create(l2Rpc, network)`**

  - **Test (Happy Path):** Call `create` with valid parameters. Verify Wormhole SDK is initialized correctly (mock `Wormhole.constructor` or `Wormhole.connect` being called). Verify logger indicates successful creation.
  - **Test (Invalid RPC/Network):** If applicable, test how it handles invalid RPC URLs or network names during SDK initialization (e.g., logs error, throws specific exception).

- **Method: `fetchAndVerifyVaaForL2Event(l2TxHash, sourceChainId, emitterAddress, targetChainId)` (or similar)**
  - **Test (Happy Path - VAA Found & Valid):**
    - Mock `l2Provider.getTransactionReceipt` to return a successful L2 transaction receipt.
    - Mock `chainContext.parseTransaction` to return valid Wormhole message IDs.
    - Mock `wormholeSDK.getVaa` (or `getVaaImplementation`) to return a valid VAA (with `.bytes` or `.serialize()`).
    - Mock `tokenBridge.isTransferCompleted` (or equivalent verification on the target chain context) to return `true`.
    - **Expected Outcome:** Service returns the VAA bytes and parsed VAA. Correct logs are made.
  - **Test (Negative - L2 Tx Reverted):** Mock `l2Provider.getTransactionReceipt` to return a receipt with `status: 0` (reverted).
    - **Expected Outcome:** Service returns `null` or throws an appropriate error. Error is logged.
  - **Test (Negative - No Wormhole Message in L2 Tx):** Mock `chainContext.parseTransaction` to return an empty array.
    - **Expected Outcome:** Service returns `null`. Error is logged.
  - **Test (Negative - `getVaa` Fails/Times Out):** Mock `wormholeSDK.getVaa` to throw an error or return `null` after retries.
    - **Expected Outcome:** Service returns `null`. Error is logged.
  - **Test (Negative - VAA Emitter/Chain Mismatch):** Mock `wormholeSDK.getVaa` to return a VAA with an unexpected emitter address or source chain.
    - **Expected Outcome:** Service returns `null` (as VAA verification fails). Error is logged.
  - **Test (Negative - `isTransferCompleted` Returns False):** Mock `tokenBridge.isTransferCompleted` to return `false`.
    - **Expected Outcome:** Service returns `null`. Error/warning is logged.
  - **Test (Negative - `isTransferCompleted` Throws Error):** Mock `tokenBridge.isTransferCompleted` to throw an error.
    - **Expected Outcome:** Service returns `null`. Error is logged.
  - **Test (VAA with `.bytes` vs `.serialize()`):** Ensure both cases for how VAA bytes are obtained are tested, as covered in the existing tests.

**3. Unit Tests:**

- Generally, the primary logic of this service lies in orchestrating calls to the Wormhole SDK and the L2 provider. Most of this is best tested via integration tests.
- **Potential candidates for Unit Tests (if sufficiently complex and isolated):**
  - Any internal helper functions that perform complex data transformations on VAA payloads or message IDs _before_ or _after_ SDK calls, if this logic is non-trivial.
  - Complex parsing of specific VAA payload types if the service itself does this beyond what the SDK provides.
