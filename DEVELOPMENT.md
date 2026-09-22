# Development Guide

This document covers building, testing, packaging, and releasing the covdbg VS Code extension.

## Repository Layout

- `src/` contains the extension source.
- `src/views/` contains the Coverage view, the status bar and the report.
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

Every build downloads a fresh `assets/portable/covdbg-portable.zip`, so the bundled covdbg is never a leftover from an earlier build.

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

`vscode:prepublish` runs the build, so packaging downloads the current portable covdbg runtime from `https://covdbg.com/download/latest/portable.zip` every time.

## Release Process

Create and push a Git tag in the form `vX.Y.Z` that matches the version in `package.json`.

```bash
git tag v0.9.0
git push origin v0.9.0
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

Use this check locally, on Windows, before tagging:

```bash
npm run build
npm run release:check -- vX.Y.Z
```

It fails unless the VS Code engine matches `@types/vscode`, the bundled covdbg reports `covdbgBundledVersion` from `package.json`, the tag matches the package version, and `CHANGELOG.md` has a dated section for that version.

## Notes

- Coverage viewing works independently from coverage execution.
- Coverage execution requires covdbg 1.3 or newer, and a sign-in or a project token for the license service.
- Repository-facing end-user documentation belongs in `README.md`; contributor workflow documentation belongs in this file.
