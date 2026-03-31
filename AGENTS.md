# AGENTS.md — tbtc-crosschain-relayer

Agent instructions and conventions for this repository.

## Repo purpose

tBTC Cross-Chain Relayer service. Listens to deposit/redemption events on L2 chains (EVM,
Solana, Starknet, Sui) and relays them to the tBTC v2 protocol on Ethereum L1 via Wormhole.
Registered in `tlabs-xyz/devops` as `crosschain-relayer`.

## Stack

- **Runtime:** Node.js 20 / Yarn 1.22
- **Language:** TypeScript (strict, ESNext)
- **Lint + format:** Biome (`yarn lint`, `yarn format`)
- **Tests:** Jest (`yarn test`, `yarn test:unit`, `yarn test:integration`)
- **Git hooks:** Lefthook (pre-commit: lint; pre-push: typecheck + test:unit)
- **DB:** PostgreSQL via Prisma ORM
- **Observability:** OTel → SigNoz; Sentry for error tracking

## Key files

| Path | Purpose |
|------|---------|
| `index.ts` | Entry point — must import `sentry.ts` and `instrumentation.ts` first |
| `sentry.ts` | Sentry initialization (reads `SENTRY_DSN` env var) |
| `instrumentation.ts` | OTel SDK initialization |
| `config/` | Chain configuration files |
| `handlers/` | Per-chain deposit/redemption event handlers |
| `services/` | Core protocol logic (Core.ts, WormholeVaaService.ts, etc.) |
| `prisma/schema.prisma` | Database schema |
| `env.example` | All required env vars with descriptions |

## Common commands

```bash
yarn install            # install deps
yarn build              # TypeScript compile → dist/
yarn test               # run all tests (requires Docker for integration)
yarn test:unit          # unit tests only (no Docker)
yarn lint               # Biome lint check
yarn format             # Biome format check
yarn typecheck          # tsc --noEmit
yarn prisma:generate    # regenerate Prisma client
yarn validate-config    # validate chain config at runtime
```

## Chain handlers

Each chain (EVM, Solana, Starknet, Sui) has a handler in `handlers/`. When adding a new
chain, implement the `ChainHandler` interface from `interfaces/`. Do not add chain-specific
logic to `services/Core.ts` — delegate to the handler.

## Environment variables

All required vars are in `env.example`. Copy to `.env` for local development.
Never hardcode secrets. `SENTRY_DSN` and `SENTRY_ENVIRONMENT` must be set via GH secrets
in deployed environments.

## Service registration

This service is registered in `tlabs-xyz/devops/config/registry.json` as `crosschain-relayer`.
When adding new environment URLs, health endpoints, or monitoring config, update the registry
entry. Run `bun run check:registry` in devops to validate.

## Workflow

```bash
yarn lint && yarn test:unit  # must pass before committing
git commit                   # lefthook runs lint automatically
git push                     # lefthook runs typecheck + test:unit automatically
```

CI runs on every push/PR: lint → typecheck → test.
