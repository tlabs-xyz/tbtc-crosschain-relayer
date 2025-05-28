# Test Plan: `AuditLog.ts` (Utility)

This document outlines concrete test plans for `utils/AuditLog.ts`.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `utils/AuditLog.ts`

This utility provides functions for creating and retrieving audit log entries, likely interacting with a database (Prisma).

**User Flows Involved:**

- Supports all user flows by providing a trail of actions and state changes, crucial for debugging, monitoring, and accountability.

**1. E2E Tests:**

- Not directly tested. The existence and correctness of audit logs might be a _secondary verification_ in some E2E tests (e.g., after a deposit E2E test, one might check if `DEPOSIT_CREATED` and `STATUS_CHANGED` audit logs were created for that depositId).

**2. Integration Tests (Focus on Prisma interaction if not mocking it away for unit tests):**
_(The existing `tests/unit/utils/AuditLog.test.ts` seems to function as integration tests for Prisma interaction, as it clears and queries a real (test) DB. This is acceptable if testing the direct Prisma interaction is the goal.)_

- **`appendToAuditLog(eventType, depositId, data, errorCode)` and specific log type functions (e.g., `logDepositCreated`, `logStatusChange`):**

  - **Test (Happy Path - Log Creation):** Call a logging function (e.g., `logDepositCreated`). Verify (by querying the test DB via Prisma) that a new `AuditLog` record is created with the correct `depositId`, `eventType`, `data` (matching the input or structured data), and `errorCode`.
  - **Test (Data Serialization):** If `data` objects are complex, verify they are correctly serialized/stored in the database and can be retrieved accurately.
  - **Test (Error Handling - DB Error):** If possible to simulate a Prisma/DB error during write (e.g., by misconfiguring Prisma client temporarily or if Prisma client mock can throw), verify the logging function handles it (e.g., logs an error to console, doesn't crash the app).

- **`getAuditLogs()` and `getAuditLogsByDepositId(depositId)`:**
  - **Test (Happy Path - Retrieve Logs):** Create several audit logs (some with a specific `depositId`, some without or with a different one). Call `getAuditLogs()` and verify all are returned. Call `getAuditLogsByDepositId` with the specific `depositId` and verify only relevant logs are returned.
  - **Test (No Logs Found):** Ensure `getAuditLogs()` returns an empty array if no logs exist. Ensure `getAuditLogsByDepositId` returns an empty array if no logs exist for that ID.
  - **Test (Data Deserialization):** Verify complex `data` objects are correctly deserialized from the database when logs are retrieved.

**3. Unit Tests (Mocking Prisma Client):**
_(These would be more focused on the logic within `AuditLog.ts` functions themselves, assuming Prisma interaction is reliable or tested separately in integration tests.)_

- **For each specific logging function (e.g., `logDepositCreated`, `logStatusChange`, `logApiRequest`):**

  - **Test (Correct Data Formatting):** Call the function with appropriate input parameters (e.g., a `deposit` object, `newStatus`, `oldStatus`). Mock `prisma.auditLog.create`. Verify that `prisma.auditLog.create` is called with a `data` payload that correctly structures and formats the input parameters into the expected audit log entry (e.g., correct `eventType`, specific fields extracted from the deposit object for the `data` field of the log).
    - Example for `logStatusChange(deposit, newStatus, oldStatus)`: Verify the `data` field passed to `prisma.auditLog.create` includes `{ new: newStatus, old: oldStatus, ...otherRelevantDepositInfo }`.
  - **Test (Input Validation):** If these functions perform any validation on their inputs before calling Prisma (e.g., checking if a required field on the `deposit` object is present), test these validation paths.

- **`appendToAuditLog(eventType, depositId, data, errorCode)` (if it has significant internal logic before calling Prisma):**

  - **Test (Parameter Mapping):** Verify `eventType`, `depositId`, `data`, and `errorCode` are correctly passed through to the `prisma.auditLog.create` call.
  - **Test (Defaulting Logic):** If `data` or `errorCode` have default values or transformations, test this logic.

- **Note on Overlap with Integration Tests:** If the existing tests for `AuditLog.ts` (which use a real DB) are deemed sufficient for verifying the Prisma interactions, then new unit tests mocking Prisma would only be valuable if there's complex data transformation or conditional logic _before_ the Prisma call that needs isolated testing. If the functions are simple wrappers around `prisma.auditLog.create` with direct data mapping, the existing tests might cover them well enough, blurring the line between unit/integration for this specific utility.

---
