# covdbg

Visualize [covdbg](https://github.com/liasoft/covdbg) code coverage directly in VS Code. Auto-discover `.covdb` databases, render inline decorations, and browse an interactive coverage report -- no extra tooling required.

This extension is open source under the Apache License 2.0. Running coverage requires the proprietary software `covdbg`, which is not open source and is licensed separately.

See [CHANGELOG.md](CHANGELOG.md) for versioned release notes.

## Features

- **Auto-Discovery** -- Finds `.covdb` files in your workspace using a configurable glob pattern
- **Live Reload** -- Polls the active database for changes and reloads coverage automatically
- **Inline Decorations** -- Highlights covered and uncovered lines with background colors, gutter icons, or both
- **Coverage Report** -- Interactive HTML report with file/folder tree, function-level details, and filtering
- **Database Switcher** -- Switch between multiple `.covdb` files from the status bar menu
- **Workspace Filtering** -- Hides external files (SDK headers, system includes) by default

## Getting Started
- 📦 **Auto-Discovery**: Finds `.covdb` files in your workspace on startup (configurable glob pattern)
- 🔄 **Live Reload**: Watches for new or changed `.covdb` files and reloads coverage automatically
- 🗄️ **Direct SQLite Access**: Reads `.covdb` databases natively — no `covdbg` binary needed for viewing
- 🎨 **Inline Decorations**: Highlights covered (green) and uncovered (red) lines in the editor
- 📊 **Coverage Reports**: HTML report with per-file coverage statistics
- 🔍 **Status Bar**: Shows loaded `.covdb` file info and per-file coverage percentage
- 📝 **Configuration Support**: Create and edit `.covdbg.yaml` filter configurations
- ▶️ **Integrated Runner (Windows + C++)**: Run test executables with `covdbg` directly from VS Code
- 🧪 **Testing API Integration**: Discovered binaries appear in the VS Code Test Explorer and can be run with coverage

## Installation

### Install from Source

1. Open repository root folder in VS Code
2. Install dependencies:
    ```bash
    npm install
    ```
3. Build the extension:
    ```bash
    npm run build
    ```
4. Press `F5` to start the extension in debug mode

The build step prepares the portable archive if needed and then compiles the extension bundle.
`F5` uses the same default build task, so you can usually just press `F5` after `npm install` and let VS Code run the build for you.

Set `COVDBG_PORTABLE_URL` if you need to test against a different portable artifact.

### Install as VSIX Package

```bash
npm install -g @vscode/vsce
npm run package
```

Then install via Command Palette → "Extensions: Install from VSIX..."

The packaging step downloads the current portable `covdbg` runtime from `https://covdbg.com/download/latest/portable.zip` into `assets/portable/covdbg-portable.zip`.
Set `COVDBG_PORTABLE_URL` if you need to package a different portable artifact.

### Local Development With Bundled covdbg

If you want the Extension Development Host to resolve the bundled `covdbg.exe` instead of relying on a system install or manual setting:

```bash
npm install
npm run build
```

Then launch the `Run Extension` configuration or press `F5`.

Notes:

- `npm run build` is idempotent with respect to the portable archive. It only downloads when `assets/portable/covdbg-portable.zip` is missing or empty.
- `F5` triggers the default one-shot build task, so it does not keep a background watcher running.
- The downloaded archive is ignored by git via `.gitignore`, so it stays local to your development machine.

## Release Process

Create a Git tag in the form `vX.Y.Z` that matches the version in `package.json`.

```bash
git tag v0.2.0
git push origin v0.2.0
```

The GitHub Actions workflow then:

- validates that the tag matches `package.json`
- installs dependencies
- runs lint and tests
- packages the extension as a VSIX
- downloads the portable `covdbg` runtime during packaging
- creates a GitHub Release and uploads the `.vsix` plus `SHA256SUMS.txt`

## Usage

### Automatic

1. Run `covdbg` against your executable (from terminal, CI, etc.)
2. Place a `.covdbg.yaml` in your workspace root
3. Open the workspace -- the extension auto-discovers the most recent `.covdb` and renders coverage

You can also open any `.covdb` file manually via **covdbg: Select .covdb File...** in the Command Palette.

## Viewing Coverage
### Run Coverage From VS Code (Windows)

1. Configure:
    - `covdbg.runner.targetExecutable` (optional on first run, auto-detected if missing)
    - optional: `covdbg.runner.targetArgs`, `covdbg.runner.configPath`, `covdbg.runner.outputPath`, `covdbg.runner.licenseServerUrl`
2. Run one of:
    - **`covdbg: Run Coverage`** (direct process run)
    - **Test Explorer → `Run with Coverage`** (auto-discovered binaries)
3. After a successful run, coverage reloads automatically.

For plug-and-play defaults:

- The extension uses bundled portable runtime by default.
- `covdbg.runner.configPath` can stay empty. The extension/covdbg resolves `.covdbg.yaml` automatically near the target executable.
- Logs are written under `.covdbg/Logs/covdbg.log` by default via `--appdata .covdbg`.
- Set `covdbg.runner.licenseServerUrl` when you want demo-license requests to go to a local `covdbg-license` Docker stack instead of production.
- Official downloads (MSI + Portable): [covdbg Download](https://covdbg.com/download/)

### Local VS Code Demo E2E (Windows)

The repository includes a ready-to-run local E2E path for the VS Code demo-license flow:

```powershell
.\scripts\Start-VSCodeDemoE2E.ps1
```

That script will:

- start the local `covdbg-license` Docker test stack
- build `covdbg` in `Debug`
- compile the VS Code extension
- launch an Extension Development Host with the local E2E workspace

The E2E workspace preconfigures:

- `build/Debug/bin/covdbg.exe` as the runner executable
- `build/Debug/bin/libDRM_tests.exe` as the initial target
- `.covdbg/demo-appdata` for `license_status.json`
- `http://localhost:3001` as the local license server override
- `COVDBG_LICENSE_PUBLIC_KEY_ENV_FILE=../covdbg-license/.devcontainer/devcontainer.env` so the native client trusts the Docker test server's development signing key

After the Extension Development Host opens, run **`covdbg: Run Coverage`** and confirm:

- the first run shows the free 30-day demo hint
- the status bar shows remaining validity
- `.covdbg/demo-appdata/license_status.json` is created

### Manual

- **`covdbg: Select .covdb File`** — Pick which `.covdb` to load from a list
- **`covdbg: Show Report`** — Open an HTML coverage summary
- **`covdbg: Refresh Test Binaries`** — Refresh executable discovery in Test Explorer

- **Green** lines were executed at least once
- **Red** lines were never executed
- Hover over a decorated line to see its execution count
- Click the status bar item to open the menu

## Commands

| Command | Description |
|---------|-------------|
| `covdbg: Open Menu` | Main menu with database info, render modes, and actions |
| `covdbg: Toggle Coverage Display` | Show or hide coverage decorations |
| `covdbg: Show Coverage Report` | Open the interactive HTML coverage report |
| `covdbg: Browse Covered Files` | Quick-pick list of covered files |
| `covdbg: Set Render Mode` | Switch between line, gutter, or both rendering |
| `covdbg: Select .covdb File...` | Pick a `.covdb` file via the system file browser |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `covdbg.covdbPath` | `""` | Explicit path to a `.covdb` file. Takes priority over auto-discovery. |
| `covdbg.discoveryPattern` | `"**/*.covdb"` | Glob pattern for auto-discovering `.covdb` files. |
| `covdbg.renderMode` | `"gutter"` | Visualisation mode: `line`, `gutter`, or `both`. |
| `covdbg.showExternalFiles` | `false` | Include files outside the workspace in coverage results. |

## License

This extension is open source under the Apache License 2.0.

It requires the proprietary software `covdbg`, which is not open source and is licensed separately.
