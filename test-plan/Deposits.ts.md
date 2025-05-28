# Test Plan: `Deposits.ts` (Utility)

This document outlines concrete test plans for `utils/Deposits.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `utils/Deposits.ts`

This utility file likely contains functions for creating, validating, transforming, or querying deposit-related data structures. Given its size, it might encapsulate a fair bit of business logic related to the definition and handling of deposits.

**User Flows Involved:**

- This utility supports various user flows by providing foundational operations or data structures for deposits. For example, creating a new deposit object before it's stored, validating incoming deposit data, or preparing deposit data for display or for sending to another service.

**1. E2E Tests:**

- The functionality within `utils/Deposits.ts` is typically too low-level to be tested directly via E2E tests. Its correctness is implicitly verified if E2E tests for user flows that rely on it (e.g., deposit initiation, status query) pass.

**2. Integration Tests:**

- If functions within `Deposits.ts` interact directly with a database (e.g., via Prisma) or other external services (which is less common for a pure utility but possible), then integration tests would be relevant.
  - **Example Scenario (if it fetches related data):**
    - **Method: `enrichDepositWithExternalData(deposit, externalId)`**
      - **Test:** Mock an external service call (e.g., a lookup service) that `enrichDepositWithExternalData` uses. Verify the deposit object is correctly updated with data from the mocked service.
      - **Test (External Service Fails):** Mock the external service to return an error. Verify `enrichDepositWithExternalData` handles this (e.g., returns deposit unchanged, throws error, logs).
- Most often, for a utility like this, its functions are pure or only interact with other local utilities/data, making unit tests more appropriate.

**3. Unit Tests (Primary focus for this type of file - Mocking any direct dependencies like other utilities or simple data stores if not testing their interaction):**

- **Assume `Deposits.ts` contains functions like:**

  - `createDepositObject(params)`: Creates a new deposit data structure.
  - `validateDepositData(data)`: Validates incoming data for a deposit.
  - `transformDepositForApi(depositInternal)`: Transforms an internal deposit object for an API response.
  - `calculateDepositHash(deposit)`: Calculates a unique hash for a deposit.
  - `isDepositFinalized(deposit)`: Checks if a deposit is in a terminal success state.
  - `isDepositFailed(deposit)`: Checks if a deposit is in a terminal failure state.

- **Method: `createDepositObject(params)`**

  - **Test (Happy Path):** Call with valid parameters. Verify the returned object has all expected fields set correctly, default values are applied where appropriate, and timestamps are sensible.
  - **Test (Missing Required Params):** Call with missing essential parameters. Verify it throws an appropriate error (e.g., `ValidationError`, `ArgumentNullError`) or returns a well-defined error object.
  - **Test (Invalid Param Types/Formats):** Call with parameters of incorrect types (e.g., string where number expected) or invalid formats (e.g., malformed address). Verify appropriate error handling.

- **Method: `validateDepositData(data)`**

  - **Test (Valid Data):** Call with a complete and valid deposit data object. Verify it returns `true` or no errors.
  - **Test (Invalid - Missing Fields):** Call with data missing one or more required fields. Verify it returns `false` or a list of validation errors.
  - **Test (Invalid - Field Formats):** Call with data where fields have incorrect formats (e.g., invalid transaction hash format, amount out of range). Verify specific validation errors.
  - **Test (Invalid - Cross-Field Validation):** If there are rules like "refundLocktime must be greater than createdAt", test these cross-field validations.

- **Method: `transformDepositForApi(depositInternal)`**

  - **Test:** Provide a sample internal deposit object. Verify the transformed object has the expected structure for API responses (e.g., fields renamed, sensitive data omitted, timestamps formatted).

- **Method: `calculateDepositHash(deposit)`**

  - **Test (Consistency):** Call multiple times with the exact same deposit data (deep equality). Verify the returned hash is identical each time.
  - **Test (Sensitivity):** Change a single field in the deposit data. Verify the returned hash is different.
  - **Test (Specific Fields):** Ensure all relevant fields that define uniqueness are included in the hash calculation.

- **Method: `isDepositFinalized(deposit)` / `isDepositFailed(deposit)`**

  - **Test:** Call with deposit objects in various statuses (QUEUED, INITIALIZED, PENDING_L1, PENDING_L2, FINALIZED, FAILED_L1, FAILED_L2_REVERT, FAILED_TIMEOUT). Verify these functions return `true` or `false` correctly based on the status.

- **General for other utility functions:**
  - For each public function, identify its inputs, outputs, and any side effects (though utilities ideally have few side effects).
  - Test happy paths with valid inputs.
  - Test edge cases (e.g., empty inputs, nulls, boundary values).
  - Test expected failure modes or error handling for invalid inputs.

---
