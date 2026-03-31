# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Sentry error tracking integration (`@sentry/node`) for production error monitoring
- OpenTelemetry logging and tracing observability via SigNoz
- OpenTelemetry SDK instrumentation with graceful shutdown handling
- Gasless deposit notification endpoint for backend integration
- AuditLog integration testing suite
- CODEOWNERS file for repository governance
- SENTRY_DSN and SENTRY_ENVIRONMENT documentation in env.example

### Changed
- Refactored instrumentation to remove duplicated graceful shutdown logic
- Updated OpenTelemetry dependencies to latest versions
- Enhanced logging with correlation IDs for better traceability
- Improved OTLP headers parsing robustness
- Updated deposit state change logging in unit tests
- Standardized dependency versioning across package.json
- Enhanced observability configuration for better visibility

### Fixed
- Fixed CodeQL security scan by adding `security-events: write` permission
- Corrected error logging with proper correlation ID propagation
- Fixed SIGINT handler for graceful OTel SDK shutdown
- Fixed depositKey calculation hash format inconsistency
- Corrected depositKey format normalization for gasless notifications
- Fixed `@keep-network/tbtc-v2.ts` mocking via Jest moduleNameMapper
- Fixed ESM config schema import by adding .js extension to validate-config
- Corrected gasless-deposits to use backend address instead of chainId for participant fields
- Fixed invalid local permission rules in config
- Disabled automatic L1 recovery to prevent race conditions
- Fixed CI workflow to properly copy environment file before stopping Docker services
- Enforced HTTPS for git protocol in CI workflows

### Security
- Enforced HTTPS for git protocol in CI workflows to prevent man-in-the-middle attacks

### Chore
- Added .worktrees to .gitignore
- Added depcheck command to package.json for dependency auditing
- Added instrumentation.ts to Dockerfile for observability setup
- Updated CI workflow for better Docker service management
- Included scripts in TypeScript build output

### Infrastructure
- Added psql client to Docker entrypoint for database readiness checks
- Added compiled validate-config runtime (removed tsx dependency at runtime)
- Updated deposit state change logging in unit tests

## [1.0.0-pre] — Initial pre-release

### Added
- Cross-chain deposit and redemption relaying (EVM, Solana, Starknet, Sui)
- PostgreSQL persistence via Prisma ORM
- REST API with Express
- Gasless deposit support for improved UX
- Conventional Commits workflow
- Docker Compose setup for local development and CI
- Jest testing framework with comprehensive unit tests
- Correlation ID tracing for request lifecycle
- Environment configuration validation

### Security
- Input validation for deposit and redemption parameters
- HTTPS enforcement in CI workflows
