# Test Plan: `Endpoint.controller.ts`

This document outlines concrete test plans for `Endpoint.controller.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `Endpoint.controller.ts`

This controller likely handles core API endpoints for deposit initiation and status checking.

**User Flows Involved:**

- User initiates a new deposit.
- User queries the status of an existing deposit.

**1. E2E Tests:**

- **Flow: Successful Deposit Initiation**
  - **Test:** Send a valid `POST /api/:chainName/reveal` request.
  - **Expected Outcome:** 200 OK, response body contains `success: true`, a `depositId`, and a relevant message. Verify that a corresponding deposit record is created or queued in the system (this might require an integration aspect or a follow-up check).
- **Flow: Deposit Initiation - Invalid Input**
  - **Test:** Send `POST /api/:chainName/reveal` with missing required fields (e.g., no `fundingTx`, no `l2DepositOwner`).
  - **Expected Outcome:** 400 Bad Request, error message indicating missing fields.
- **Flow: Deposit Initiation - Invalid Chain**
  - **Test:** Send `POST /api/:invalidChainName/reveal`.
  - **Expected Outcome:** 404 Not Found or 400 Bad Request, error message indicating the chain is not supported/configured.
- **Flow: Successful Deposit Status Query**
  - **Test:** After a deposit is initiated (can use the ID from a previous E2E test or a pre-existing test deposit), send `GET /api/:chainName/deposit/:depositId` with a valid `depositId`.
  - **Expected Outcome:** 200 OK, response body contains `success: true`, the correct `depositId`, and the current `status` (e.g., QUEUED, INITIALIZED).
- **Flow: Deposit Status Query - Non-Existent Deposit**
  - **Test:** Send `GET /api/:chainName/deposit/:nonExistentDepositId`.
  - **Expected Outcome:** 404 Not Found, error message indicating deposit not found.
- **Flow: Deposit Status Query - Invalid Deposit ID Format**
  - **Test:** Send `GET /api/:chainName/deposit/:invalidFormatId`.
  - **Expected Outcome:** 400 Bad Request, error message indicating invalid ID format.

**2. Integration Tests (Mocking `ChainHandler` or underlying services):**

- **`handleReveal(req, res)` Method:**
  - **Test:** Call `handleReveal` with a mock `req` containing valid reveal data. Verify `ChainHandler.initiateDeposit` (or equivalent service method) is called with correct parameters. Verify `res.status(200)` and `res.json()` are called with expected success payload.
  - **Test:** Call `handleReveal` with mock `req` missing required fields. Verify `ChainHandler.initiateDeposit` is NOT called. Verify `res.status(400)` and `res.json()` are called with expected error payload.
  - **Test:** If `ChainHandler.initiateDeposit` throws a specific known error (e.g., `DuplicateDepositError`), mock this and verify `handleReveal` catches it and returns an appropriate HTTP error (e.g., 409 Conflict).
- **`getDepositStatus(req, res)` Method:**
  - **Test:** Call `getDepositStatus` with a mock `req` containing a valid `depositId`. Mock `ChainHandler.getDepositStatus` to return a sample deposit status. Verify `res.status(200)` and `res.json()` are called with the expected deposit data.
  - **Test:** Call `getDepositStatus` with a mock `req`. Mock `ChainHandler.getDepositStatus` to return `null` (deposit not found). Verify `res.status(404)` and `res.json()` are called.
  - **Test:** If `ChainHandler.getDepositStatus` throws an unexpected error, mock this and verify `getDepositStatus` handles it gracefully (e.g., returns 500 Internal Server Error).

**3. Unit Tests:**

- Generally, controller logic itself (parsing request, calling a service, formatting response) is often simple enough to be covered by integration tests. Unit tests here would only be for unusually complex private helper functions within the controller, if any, that perform non-trivial data transformation or validation logic not directly tied to service interaction.
