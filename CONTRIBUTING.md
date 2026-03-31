# Contributing

## Branching Strategy

- `main` — protected, requires PR review before merge
- Feature branches: `feat/<short-description>`
- Bug fix branches: `fix/<short-description>`
- Chore branches: `chore/<short-description>`

Branch directly from `main`. Keep branches short-lived.

## Commit Conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`

Examples:
- `feat(evm): add Wormhole manual VAA bridging`
- `fix(tests): resolve chain detection test failure`
- `chore: add biome lint config`

## Pull Request Process

1. Open a PR against `main`
2. Ensure CI passes (lint → typecheck → test)
3. Request review from a CODEOWNER (see `.github/CODEOWNERS`)
4. Address review feedback — do not force-push after review starts
5. Merge strategy: **Squash and merge** for features; **Merge commit** for releases

## Local Setup

```bash
yarn install
cp env.example .env   # fill in required values
docker compose up -d postgres
npx prisma migrate deploy
yarn dev
```

## Running Tests

```bash
yarn test:unit          # fast, no Docker needed
yarn test:integration   # requires Docker (postgres + services)
yarn test               # all tests
```

## Linting and Formatting

```bash
yarn lint       # check
yarn lint:fix   # auto-fix
yarn format     # check
yarn format:fix # auto-fix
```

Pre-commit hook runs lint automatically. Pre-push runs typecheck + unit tests.
