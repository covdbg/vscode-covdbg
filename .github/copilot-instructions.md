# Copilot instructions for vscode-covdbg

These rules apply to every file Copilot generates or edits in this repository.

## Formatting & line endings

- Always honor `.editorconfig`, `.prettierrc.json`, and `.gitattributes`.
- All text files use **UTF-8** with **LF** line endings. The only exceptions are `*.bat`, `*.cmd`, and `*.ps1`, which use CRLF.
- Indentation is **4 spaces** for TypeScript, JavaScript, JSON, and Markdown. YAML uses **2 spaces**.
- Insert a final newline; trim trailing whitespace (except in Markdown).
- TypeScript / JavaScript style follows Prettier defaults declared in `.prettierrc.json`:
    - `printWidth: 100`, `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `arrowParens: "always"`.
- Run `npm run format` before committing. Use `npm run format:check` for verification only.
- Run `npm run lint` and fix ESLint warnings introduced by your changes.

## Coding conventions

- TypeScript source lives under `src/`. Keep imports sorted by group (node builtins, vscode, third party, relative) and prefer named imports.
- Do not introduce default exports for new modules; use named exports to match existing code.
- Do not commit generated artifacts (`out/`, `test-out/`, `*.vsix`, `*.tsbuildinfo`).
- Keep `package.json` indented with 4 spaces.

## Tests

- Unit tests use the Node built-in test runner. Test files live under `src/test/` and end with `.test.ts`.
- Run tests via `npm test` (it compiles first).

## Pull requests / commits

- Before finishing a task, ensure `npm run format:check`, `npm run lint`, and `npm run build` succeed locally.
- Never bypass formatting or lint by disabling rules unless absolutely necessary; explain inline if you must.

## Automation

- The PR workflow (`.github/workflows/pr.yml`) runs `format:check`, `lint`, `build`, `test`, and `package`. All must pass.
- Copilot cloud agent hooks live in `.github/hooks/hooks.json`:
    - `postToolUse` runs Prettier on any file the agent edits/creates.
    - `sessionEnd` runs `npm run format:check` and `npm run lint` as a final guard.
