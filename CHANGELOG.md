# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

## [0.8.0] - 2026-04-25

### Changed

- Active `.covdb` files now reload from event-driven file watchers instead of timestamp polling, and external changes are deferred until coverage workflows are idle so background refreshes do not interfere with active test execution.
- Removed the deprecated VS Code-side analyze-inputs workflow and related settings now that covdbg can resolve analysis directly from `.conf` / `.covdbg.yaml` configuration.

## [0.7.0] - 2026-04-15

### Added

- Optional `covdbg.runner.binaryDiscoveryExcludePattern` setting so projects can hide copied or post-build duplicated test executables from Testing API discovery.
- Optional `covdbg.runner.analyzeInputs` setting so VS Code coverage runs can build baseline symbol `.covdb` files with `covdbg analyze` and merge them into the active workspace result.
- Optional `covdbg.runner.analyzeInputsByTarget` setting so different test executables can choose different analyze baselines or opt out of baseline analysis entirely.

### Changed

- Test binary discovery now refreshes from explicit Testing API resolve/refresh flows instead of filesystem watchers.
- Discovered test binary search now applies user exclude globs after the include glob, so excluded paths win even when they still match `covdbg.runner.binaryDiscoveryPattern`.
- Coverage finalization now also runs for single-executable workflows when baseline analyze inputs are configured, so the final `.covdb` can include uncovered lines from application binaries.


## [0.6.0] - 2026-04-14

### Added

- AI/chat tool integration for `exploreUncoveredFiles_covdbg`, exposing the active workspace coverage summary and the highest-priority uncovered files without requiring a `.covdb` path.
- Batched coverage runs for `runTestWithCoverage_covdbg`, allowing multiple real test executables to be run in one workflow and merged into a single active workspace coverage result.
- Richer uncovered-code payload metadata, including file identity details and reusable coverage summaries for downstream chat workflows.

### Changed

- Tool guidance for coverage exploration and reruns now assumes the extension-managed active workspace coverage result instead of asking chat clients to thread `.covdb` paths through each step.
- Sidebar onboarding now refreshes immediately when `.covdbg.yaml` files are created, updated, or deleted, and surfaces an explicit runtime-checking state while the active workspace is still being resolved.

### Fixed

- Deleting a `.covdbg.yaml` file now clears matching stale `covdbg.runner.configPath` settings automatically.
- Sidebar quick actions no longer appear blocked while covdbg runtime detection is still in progress.

## [0.5.0] - 2026-04-09

### Added

- AI/chat tool integration for `getUncoveredCode_covdbg`, exposing grouped uncovered segments, surrounding context, truncation metadata, and LLM guidance from native `.covdb` coverage data.
- AI/chat tool integration for `runTestWithCoverage_covdbg`, allowing an LLM to trigger a coverage run for a chosen executable and reload coverage results into the extension.
- LLM-oriented guidance in tool responses so iterative fix, rebuild, re-run, and re-query workflows can be chained from chat.

### Changed

- Uncovered code responses now cap segment volume, truncate oversized snippets, and round `coveragePercent` to two decimals for more stable chat payloads.

### Fixed

- Coverage decorations and uncovered-code queries now suppress stale results when the source file is dirty or newer than the loaded `.covdb` snapshot.

## [0.4.0] - 2026-04-09

### Added

- Always-on startup activation so the covdbg status bar entry is available immediately after VS Code finishes starting.
- In-product setup flow and command for creating a starter `.covdbg.yaml` in the selected workspace folder.
- Coverage key matching regression tests for ambiguous multi-workspace file paths.

### Changed

- Workspace discovery now searches `.covdbg.yaml` and `.covdb` files per workspace folder in multi-root workspaces.
- Runner and test executable resolution now honor workspace-folder scoped settings instead of always binding to the first workspace folder.
- Coverage loading, caching, invalidation, report state, and editor rendering are now tracked per workspace folder so duplicated project layouts do not share coverage overlays.

### Fixed

- Coverage rendering no longer cross-applies results between similarly named files such as duplicated `src/main.cpp` files opened from different workspace folders.

## [0.3.0] - 2026-04-09

### Added

- Pull request validation workflow for changes targeting `main`, covering lint, build, automated tests, and VSIX artifact upload.
- Release automation now publishes the generated VSIX to the VS Code Marketplace when the `VSCE_PAT` secret is configured.

### Changed

- Local F5 development now uses a one-shot build flow that prepares the bundled portable `covdbg` archive when it is missing.
- Release automation now serializes runs per tag and explicitly validates lint, build, and tests before packaging the VSIX.

## [0.2.0] - 2026-03-18

### Added

- Apache License 2.0 metadata and repository license file.
- Clear licensing documentation for the open-source VS Code extension and the separately licensed proprietary `covdbg` runtime.
- Build-time download of the portable `covdbg` runtime for packaging instead of storing the ZIP in the repository.
- Tag-based GitHub Actions release workflow for building the VSIX and publishing GitHub Release assets.
- Release tag validation script to enforce `vX.Y.Z` tags matching `package.json`.

### Changed

- VSIX packaging now prepares the bundled portable runtime automatically.
- Release packaging now includes a reproducible CI/CD path with checksum generation.

### Fixed

- Repository packaging no longer depends on a checked-in `assets/portable/covdbg-portable.zip`.

## [0.1.0]

### Added

- Initial extension development baseline.
- Coverage viewer integration for `.covdb` files.
- Inline coverage decorations, report views, status bar integration, and basic runner support.
