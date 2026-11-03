# Repository Guidelines

## Project Structure & Module Organization

This repository is currently an empty workspace. It has no source code, tests, assets, dependency manifests, or build configuration. When adding the initial implementation, organize application code under `src/`, automated tests under `tests/`, and supporting documentation under `docs/`. Create these directories only when needed, and update this guide to reflect the actual layout.

## Build, Test, and Development Commands

No build, test, or local development commands are configured yet. When introducing a toolchain, document its installation prerequisites and exact commands in `README.md`. Provide reproducible commands for running locally, testing, and any required build step. Do not assume that commands such as `npm test` or `make build` are available until their configuration is committed.

## Coding Style & Naming Conventions

Follow the idioms of the language selected for the project. Use consistent indentation within each file, descriptive names, and small modules with clear responsibilities. Prefer lowercase, hyphen-separated names for documentation files where practical. Add a formatter and linter appropriate to the chosen language, commit their configuration, and document how to run them.

## Testing Guidelines

No testing framework or coverage threshold is established. Introduce automated tests alongside the first executable functionality. Use descriptive test names that explain the behavior being checked, and cover normal operation, invalid inputs, and relevant boundary cases. Keep tests deterministic and document the complete test command.

## Commit & Pull Request Guidelines

No Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add research data loader`, and keep each commit focused. Pull requests should describe the purpose, summarize changes, list validation performed, and link relevant issues. Include screenshots when changes affect a user interface.

## Security & Configuration

Never commit credentials, API keys, or private datasets. Keep local configuration outside version control and provide placeholder values in an example configuration file when configuration becomes necessary.
