# covdbg for VS Code

Windows C++ coverage inside VS Code.

Open existing `.covdb` files, run Windows test binaries with coverage, and inspect covered and uncovered lines without leaving the editor.

[Download the covdbg runtime](https://covdbg.com/download/) | [Learn more at covdbg.com](https://covdbg.com/)

## See Coverage In VS Code

![Run coverage and inspect covered and uncovered lines directly in VS Code](gif/readme-demo.gif)

Open a `.covdb`, run coverage from the editor, and move from inline highlights to a detailed coverage report in a single workflow.

> The extension is open source. Running coverage requires the separately licensed covdbg runtime, available from [covdbg.com/download](https://covdbg.com/download/).

## Why covdbg

- Open `.covdb` files directly with no conversion step.
- See covered and uncovered lines where you are already editing.
- Jump from inline highlights to a report with file, folder, and function detail.
- Run Windows C++ executables with coverage from VS Code and reload results automatically.
- Rerun discovered test binaries with coverage from the Testing UI.

## What You Get

### Inline coverage visualization

covdbg highlights covered and uncovered lines using gutter markers, line backgrounds, or both.

### Interactive report

Open a coverage report with file and folder summaries, per-file statistics, and function-level details.

### Automatic `.covdb` discovery

Point the extension at a specific database or let it discover coverage artifacts in your workspace automatically.

### Coverage runs from VS Code

Run a Windows executable under covdbg without leaving the editor. The extension can resolve the runtime, launch your target, and reload the resulting `.covdb` output automatically.

### Test Explorer integration

Discovered test binaries can appear in the VS Code Testing UI and can be rerun with coverage.

## Quick Start

1. Install the covdbg runtime from [covdbg.com/download](https://covdbg.com/download/).
2. Open your C++ workspace in VS Code.
3. Either:
   - open an existing `.covdb` file, or
   - configure a target executable and run coverage from the extension.
4. Review coverage inline or open the HTML report.

## Typical Workflows

### View an existing coverage database

Use `covdbg: Select .covdb File...` or set `covdbg.covdbPath`.

### Run coverage from VS Code

Configure `covdbg.runner.targetExecutable`, then run `covdbg: Run Coverage`.

### Work from the Testing UI

Let the extension discover likely test binaries and run them with coverage from the Test Explorer.

## Commands

| Command | Description |
|---------|-------------|
| `covdbg: Open Menu` | Open the main covdbg action menu. |
| `covdbg: Toggle Coverage Display` | Show or hide inline coverage decorations. |
| `covdbg: Show Coverage Report` | Open the interactive HTML coverage report. |
| `covdbg: Browse Covered Files` | Open a quick pick for covered files. |
| `covdbg: Set Render Mode` | Switch between line, gutter, or combined rendering. |
| `covdbg: Select .covdb File...` | Choose a coverage database manually. |
| `covdbg: Run Coverage` | Launch the configured executable with coverage. |
| `covdbg: Refresh Test Binaries` | Refresh executable discovery for the Testing UI. |

## Key Settings

| Setting | Purpose |
|---------|---------|
| `covdbg.covdbPath` | Load a specific `.covdb` file. |
| `covdbg.discoveryPattern` | Control automatic `.covdb` discovery. |
| `covdbg.renderMode` | Choose line, gutter, or both. |
| `covdbg.showExternalFiles` | Include files outside the workspace in results. |
| `covdbg.runner.targetExecutable` | Select the Windows executable to run with coverage. |
| `covdbg.runner.targetArgs` | Pass arguments to the target executable. |
| `covdbg.runner.outputPath` | Choose where the generated `.covdb` should be written. |
| `covdbg.runner.binaryDiscoveryPattern` | Control test binary discovery for the Testing UI. |

## Learn More

- Product site: [covdbg.com](https://covdbg.com/)
- Downloads: [covdbg.com/download](https://covdbg.com/download/)
- Development guide: [DEVELOPMENT.md](https://github.com/covdbg/vscode-covdbg/blob/main/DEVELOPMENT.md)
- Release notes: [CHANGELOG.md](https://github.com/covdbg/vscode-covdbg/blob/main/CHANGELOG.md)

## License

This extension is open source under the Apache License 2.0.

The covdbg runtime itself is proprietary software and is licensed separately.
