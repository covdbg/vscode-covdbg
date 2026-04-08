# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

### Added

### Changed

- Ongoing work after `0.4.0` will be tracked here until the next tagged release.

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
