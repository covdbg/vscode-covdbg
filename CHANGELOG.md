# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

### Changed

- Ongoing work after `0.2.0` will be tracked here until the next tagged release.
- Local F5 development now uses a one-shot build flow that prepares the bundled portable `covdbg` archive when it is missing.

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
