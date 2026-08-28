# covdbg for VS Code

[![codecov](https://codecov.io/github/covdbg/vscode-covdbg/graph/badge.svg?token=7NJ34AP0R4)](https://codecov.io/github/covdbg/vscode-covdbg)

Native Windows C++ coverage, directly in VS Code.

Run real executables with coverage, inspect covered and uncovered lines in the editor, open a detailed report, and keep the whole workflow inside the IDE.

<img src="https://media.githubusercontent.com/media/covdbg/vscode-covdbg/main/gif/readme-demo.gif" width=800 height=500>

[Get started with covdbg](https://covdbg.com/) | [Product docs and guides](https://covdbg.com/docs/)

## Why It Exists

Native Windows coverage is often fragmented across runners, reports, and local scripts. covdbg keeps that loop in one place.

- Use existing Windows binaries and debug symbols.
- Avoid compiler-specific instrumentation workflows.
- Review coverage where you edit and debug.
- Move quickly from a run to exact uncovered lines and functions.
- Keep results local to the machine and workspace.

## What The Extension Does

### Run coverage from VS Code

Choose a discovered executable, start a run, and let covdbg load the latest result back into the workspace automatically.

### Show coverage inline in the editor

See covered and uncovered lines with gutter markers, line highlights, or both while you work in source.

### Open a full interactive report

Drill into file, folder, and function summaries when you need more than line-level overlays.

### Work with discovered test binaries

Find likely test executables in the workspace and rerun them with coverage from the built-in Testing view.

### Load existing coverage results

Point covdbg at an existing `.covdb` file or let it discover results in the workspace automatically.

### Get a workspace dashboard

Use the sidebar to see runtime status, discovered tests, loaded coverage, config health, and the next useful action.

## Coverage Scope With `.covdbg.yaml`

Use `.covdbg.yaml` to decide what counts in the report. This is where you keep SDKs, vendored code, external dependencies, and helper-only test code out of project coverage.

```yaml
version: 1
source_root: "."
coverage:
	default:
		files:
			include:
				- "**/*.cpp"
				- "**/*.h"
			exclude:
				- "tests/helpers/**"
				- "third_party/**"
				- "external/**"
				- "vendor/**"
				- "**/Windows Kits/**"
				- "**/VC/Tools/MSVC/**"

		functions:
			include:
				- "*"
			exclude:
				- "__scrt_*"
				- "_RTC_*"
				- "__security_*"
```

The extension can generate a starter config, then you can tune it to match your binaries and source layout.

## AI Coverage Workflows

covdbg ships an MCP server, and the extension offers it to VS Code automatically. Nothing to
install and nothing to configure: open a C++ workspace on Windows and the server appears under
**MCP: List Servers** as `covdbg`.

Chat-capable tooling can then drive coverage end to end:

- Run a test executable under coverage, wait for it to finish, or cancel it.
- Open a `.covdb`, list the files with the most uncovered lines, and read the uncovered segments
  of any one of them with their surrounding context.
- Query a coverage database directly with read-only SQL, and merge several databases into one.

A run that names no output path writes to the location `covdbg.runner.outputPath` configures
(`.covdbg/coverage.covdb` by default), so the result loads into the editor on its own - the
gutter decorations and the sidebar update without a command.

This supports a tight loop: inspect uncovered code, make a fix, rebuild, rerun the real tests
with coverage, and query the updated result again.

Licensing follows the same rules as a run started from the UI. If `COVDBG_LICENSE` or
`COVDBG_LICENSE_FILE` is set for the window, covdbg uses it; otherwise a plugin demo licence is
requested.

## Quick Start

1. Install the extension on Windows and open your C++ workspace.
2. Open the covdbg sidebar to verify runtime, config, and discovered targets.
3. Add or generate `.covdbg.yaml` so the report matches your project boundaries.
4. Run coverage on a discovered executable.
5. Review inline highlights or open the report for deeper inspection.

If you already have a `.covdb` result, load it and start browsing immediately.

## Learn More

- Product site: [covdbg.com](https://covdbg.com/)
- Documentation: [covdbg.com/docs](https://covdbg.com/docs/)
- Development guide: [DEVELOPMENT.md](https://github.com/covdbg/vscode-covdbg/blob/main/DEVELOPMENT.md)
- Release notes: [CHANGELOG.md](https://github.com/covdbg/vscode-covdbg/blob/main/CHANGELOG.md)
