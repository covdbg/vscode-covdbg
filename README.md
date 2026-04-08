# covdbg for VS Code

Native Windows C++ coverage, directly in VS Code.

Run your executables with coverage, inspect covered and uncovered lines in the editor, open a detailed report, and rerun discovered test binaries from the Testing view. The extension bundles the covdbg runtime for a smoother setup on Windows.

[Get started with covdbg](https://covdbg.com/) | [Product docs and guides](https://covdbg.com/docs/)

## See Coverage In VS Code

<img src="https://media.githubusercontent.com/media/covdbg/vscode-covdbg/main/gif/readme-demo.gif" width=800 height=500>

covdbg brings the full coverage workflow into the editor: launch a target, reload results automatically, review inline highlights, and drill into file, folder, and function details without bouncing between separate tools.

## Why covdbg

Getting useful coverage for native Windows C++ is usually more work than it should be. covdbg is built to make that workflow practical:

- Use your existing Windows binaries and debug symbols.
- Avoid compiler-specific instrumentation workflows and extra build-system churn.
- Review coverage where you already edit and debug.
- Move from a single run to actionable file and function detail quickly.
- Keep coverage local to your machine and workspace.

## What You Get In The Extension

### Run coverage without leaving the editor

Choose a target executable, start a coverage run from VS Code, and let the extension reload the latest result automatically.

### Inline coverage that stays close to the code

Show covered and uncovered lines with gutter markers, line highlights, or both, so gaps are visible while you work.

### Interactive report for deeper inspection

Open a report with file and folder summaries, per-file statistics, and function-level detail when you want more than a line overlay.

### Testing UI integration

Discover likely test binaries in your workspace and rerun them with coverage from the built-in Testing view.

### Flexible result loading

Point covdbg at an existing coverage result or let it discover results in your workspace automatically.

## Quick Start

1. Install the extension on Windows.
2. Open your C++ workspace in VS Code.
3. Configure `covdbg.runner.targetExecutable` for the binary you want to run.
4. Run `covdbg: Run Coverage`.
5. Review coverage inline or open `covdbg: Show Coverage Report`.

If you already have a coverage result, use `covdbg: Select .covdb File...` and start browsing immediately.

## Typical Workflows

### Run a native test binary with coverage

Set `covdbg.runner.targetExecutable`, optionally add `covdbg.runner.targetArgs`, then launch `covdbg: Run Coverage`.

### Rerun discovered tests from the Testing view

Use `covdbg: Refresh Test Binaries` to discover likely test executables and run them with coverage from the Test Explorer.

### Open and inspect an existing result

Use `covdbg: Select .covdb File...` or set `covdbg.covdbPath` to load an existing result for inline review and reporting.

## Commands

| Command | Description |
|---------|-------------|
| `covdbg: Open Menu` | Open the main covdbg action menu. |
| `covdbg: Toggle Coverage Display` | Show or hide inline coverage decorations. |
| `covdbg: Show Coverage Report` | Open the interactive HTML coverage report. |
| `covdbg: Browse Covered Files` | Jump to files that have coverage data. |
| `covdbg: Set Render Mode` | Switch between line, gutter, or combined rendering. |
| `covdbg: Select .covdb File...` | Load a specific coverage result manually. |
| `covdbg: Run Coverage` | Run the configured executable with coverage. |
| `covdbg: Clear Last Run Result` | Clear the last generated run result from the current workflow. |
| `covdbg: Refresh Test Binaries` | Refresh executable discovery for the Testing UI. |

## Key Settings

| Setting | Purpose |
|---------|---------|
| `covdbg.runner.targetExecutable` | Windows executable to run with coverage. |
| `covdbg.runner.targetArgs` | Arguments passed to the target executable. |
| `covdbg.runner.workingDirectory` | Working directory for coverage runs. |
| `covdbg.runner.outputPath` | Output path for results generated from VS Code. |
| `covdbg.runner.binaryDiscoveryPattern` | Pattern used to discover test binaries for the Testing UI. |
| `covdbg.covdbPath` | Load a specific existing coverage result. |
| `covdbg.discoveryPattern` | Pattern used to discover coverage results automatically. |
| `covdbg.renderMode` | Choose line, gutter, or both. |
| `covdbg.showExternalFiles` | Include files outside the workspace in results. |

## Learn More

- Product site: [covdbg.com](https://covdbg.com/)
- Documentation: [covdbg.com/docs](https://covdbg.com/docs/)
- Development guide: [DEVELOPMENT.md](https://github.com/covdbg/vscode-covdbg/blob/main/DEVELOPMENT.md)
- Release notes: [CHANGELOG.md](https://github.com/covdbg/vscode-covdbg/blob/main/CHANGELOG.md)
