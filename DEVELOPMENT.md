# Development Guide

This document covers building, testing, packaging, and releasing the covdbg VS Code extension.

## Repository Layout

- `src/` contains the extension source.
- `views/` contains report and UI helpers.
- `scripts/` contains bundling, portable download, and release validation scripts.
- `assets/portable/` is used for the portable covdbg runtime archive during local packaging.

## Prerequisites

- Windows
- Node.js and npm
- VS Code

For full runner testing, install a covdbg runtime locally or use the bundled portable flow described below.

## Install Dependencies

```bash
npm install
```

## Build

```bash
npm run build
```

The build performs two steps:

1. `npm run prepare:portable`
2. `npm run compile`

If `assets/portable/covdbg-portable.zip` is missing or empty, the portable archive is downloaded automatically.

## Development Loop

Use the standard build for a one-shot compile:

```bash
npm run build
```

Use the watch bundler when iterating on source changes:

```bash
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

## Local Development With Bundled covdbg

If you want the Extension Development Host to resolve the bundled `covdbg.exe` instead of relying on a system install or a manual path setting:

```bash
npm install
npm run build
```

Then start the `Run Extension` launch configuration or press `F5`.

Notes:

- `npm run build` is idempotent with respect to the portable archive.
- The downloaded archive stays local because it is ignored by git.
- Set `COVDBG_PORTABLE_URL` to test with a different portable artifact.

## Tests And Validation

Run type checking:

```bash
npm run typecheck
```

Compile test files:

```bash
npm run compile:tests
```

Run the test suite:

```bash
npm test
```

Run the test suite with coverage:

```bash
npm run test:coverage
```

The coverage command measures compiled extension modules under `test-out/`, excludes compiled test files, prints a text summary, and writes `coverage/lcov.info` for Codecov.

Run linting:

```bash
npm run lint
```

## Packaging

Build a VSIX locally:

```bash
npm run package
```

The package flow downloads the current portable covdbg runtime from `https://covdbg.com/download/latest/portable.zip` if needed.

## Local VS Code Demo E2E

The repository includes a local end-to-end path for the VS Code demo-license flow:

```powershell
.\scripts\Start-VSCodeDemoE2E.ps1
```

That workflow is expected to:

- start the local `covdbg-license` Docker test stack
- build `covdbg` in `Debug`
- compile the VS Code extension
- launch an Extension Development Host with the local E2E workspace

The E2E workspace is configured to use:

- `build/Debug/bin/covdbg.exe` as the runner executable
- `build/Debug/bin/libDRM_tests.exe` as the initial target
- `.covdbg/demo-appdata` for `license_status.json`
- `http://localhost:3001` as the local license server override
- `COVDBG_LICENSE_PUBLIC_KEY_ENV_FILE=../covdbg-license/.devcontainer/devcontainer.env` so the native client trusts the Docker test server development key

After the Extension Development Host opens, run `covdbg: Run Coverage` and verify the demo-license flow and status bar state.

## Release Process

Create and push a Git tag in the form `vX.Y.Z` that matches the version in `package.json`.

```bash
git tag v0.3.0
git push origin v0.3.0
```

The release workflow then:

- validates that the tag matches `package.json`
- installs dependencies
- runs lint and tests
- packages the extension as a VSIX
- publishes the generated VSIX to the VS Code Marketplace
- downloads the portable covdbg runtime during packaging
- creates a GitHub Release and uploads the `.vsix` plus `SHA256SUMS.txt`

Before using the workflow for a real release, configure this repository secret:

- `VSCE_PAT`: Azure DevOps Personal Access Token for the Marketplace publisher in `package.json`, created with `Organization: All accessible organizations` and `Marketplace: Manage` scope.

Marketplace prerequisites:

- the `publisher` field in `package.json` must already exist in the Visual Studio Marketplace
- the PAT must belong to an account that can publish for that publisher

Once the secret is present, a `vX.Y.Z` tag will both publish the extension to the VS Code Marketplace and attach the same VSIX to the GitHub release.

Use this check locally before tagging:

```bash
npm run release:check
```

## Notes

- Coverage viewing works independently from coverage execution.
- Coverage execution requires the proprietary covdbg runtime and license flow.
- Repository-facing end-user documentation belongs in `README.md`; contributor workflow documentation belongs in this file.
