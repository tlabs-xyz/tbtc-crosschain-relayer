# Deployment

## Target Environment

**Platform:** DigitalOcean App Platform
**Environment:** Testnet
**Service URL:** configured as `DO_APP_URL` repository variable (see repo Settings → Variables)
**Health endpoint:** `GET /status` → `200 OK`
**Registry:** `tlabs-xyz/devops` → `config/registry.json` as `crosschain-relayer`

## How to Deploy

Deployments are triggered automatically on push to `main` via the deploy workflow
(`.github/workflows/deploy.yml`). Manual deployment:

1. In the DO App Platform dashboard, navigate to the `tbtc-crosschain-relayer` app
2. Under **Deployments**, click **Deploy**
3. Monitor the build log (takes ~3–5 minutes)
4. Verify: `curl ${DO_APP_URL}/status`

## Environment Variables / Secrets

All required env vars are in `env.example`. In deployed environments:

| Variable | How it's set |
|----------|-------------|
| `DATABASE_URL` | DO App Platform env (encrypted) |
| `SENTRY_DSN` | GH secret `SENTRY_DSN` → DO App Platform env |
| `SENTRY_ENVIRONMENT` | Set to `testnet` in DO App Platform |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Set to SigNoz endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | SigNoz ingestion key (encrypted) |
| Chain RPC URLs / API keys | DO App Platform env (encrypted) |

**Never commit real values.** Rotate secrets via `bun run infra:up` in `tlabs-xyz/devops`.

## Rollback

If a deployment is broken:

1. DO App Platform dashboard → **Deployments** → select last known-good deployment
2. Click **Rollback to this deployment**
3. Verify: `curl ${DO_APP_URL}/status`

**Database migrations:** Prisma does not auto-rollback. To revert a migration:
1. Roll back the app first
2. Manually revert the migration SQL or run `prisma migrate resolve --rolled-back <migration>`
3. Re-deploy

## Prisma Migrations

Migrations run automatically at startup via `yarn db:migrate` (`prisma migrate deploy`).

Check status: `npx prisma migrate status`

## Promotion Path

Currently: `main` → testnet only. No mainnet deployment yet.

To promote to mainnet:
1. Create a `mainnet` environment in DO App Platform with mainnet RPC/API values
2. Add `mainnet` entry to `tlabs-xyz/devops/config/registry.json`
3. Set `SENTRY_ENVIRONMENT=mainnet` in the mainnet environment
