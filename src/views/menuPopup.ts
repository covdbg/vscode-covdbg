import * as vscode from "vscode";
import * as path from "path";
import { RenderMode } from "../types";
import { CovdbFileSummary } from "../coverage/covdbParser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Read-only snapshot of state the menu needs to render. */
export interface MenuContext {
    isLoaded: boolean;
    isCoverageEnabled: boolean;
    activeCovdbPath: string | undefined;
    fileIndex: Map<string, CovdbFileSummary>;
    currentRenderMode: RenderMode;
    activeFileSummary: CovdbFileSummary | undefined;
    /** All .covdb files discovered in the workspace (for the switcher). */
    availableCovdbFiles: vscode.Uri[];
}

/** Callbacks the menu can trigger — keeps UI decoupled from extension logic. */
export interface MenuActions {
    toggle(): void;
    setRenderMode(mode: RenderMode): void;
    browse(): void;
    showReport(): void;
    configure(): void;
    createConfig(): void;
    openSettings(): void;
    switchDatabase(covdbPath: string): void;
    closeDatabase(): void;
    runCoverage(): void;
    clearLastRunResult(): void;
    openTestsView(): void;
}

// ---------------------------------------------------------------------------
// Main menu (status-bar click)
// ---------------------------------------------------------------------------

interface MenuItem extends vscode.QuickPickItem {
    action?: string;
    mode?: RenderMode;
}

export async function showMenu(ctx: MenuContext, actions: MenuActions): Promise<void> {
    const items: MenuItem[] = [];
    const modeLabel = (m: RenderMode) =>
        m === "line" ? "Full Line" : m === "gutter" ? "Gutter" : "Both";

    if (ctx.isLoaded && ctx.activeCovdbPath) {
        // ── Database section ──
        const overall = computeOverallStats(ctx.fileIndex);
        const pct = overall.total > 0 ? (overall.covered / overall.total) * 100 : 0;
        items.push({
            label: "Coverage Database",
            kind: vscode.QuickPickItemKind.Separator,
            action: "",
        });
        items.push({
            label: `$(database)  ${path.basename(ctx.activeCovdbPath)}`,
            description: `${ctx.fileIndex.size} files — click to switch`,
            detail: `    ${overall.covered} / ${overall.total} lines — ${pct.toFixed(1)}%`,
            action: "switch-database",
        });

        // ── Active file section ──
        if (ctx.activeFileSummary) {
            const s = ctx.activeFileSummary;
            items.push({
                label: "Current File",
                kind: vscode.QuickPickItemKind.Separator,
                action: "",
            });
            const display = vscode.workspace.workspaceFolders
                ? vscode.workspace.asRelativePath(s.filePath)
                : path.basename(s.filePath);
            items.push({
                label: `$(file-code)  ${display}`,
                detail: `    ${s.coveredLines} / ${s.totalLines} lines — ${s.coveragePercent.toFixed(1)}%`,
                action: "noop",
            });
        }

        // ── Rendering section ──
        items.push({ label: "Rendering", kind: vscode.QuickPickItemKind.Separator, action: "" });
        for (const m of ["line", "gutter", "both"] as RenderMode[]) {
            const active = m === ctx.currentRenderMode;
            items.push({
                label: `${active ? "$(check)" : "$(blank)"}  ${modeLabel(m)}`,
                action: "render-mode",
                mode: m,
            });
        }

        // ── Actions section ──
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator, action: "" });
        items.push({
            label: `$(list-flat)  Browse Files`,
            description: `${ctx.fileIndex.size} files`,
            action: "browse",
        });
        items.push({
            label: `$(graph)  Coverage Report`,
            action: "report",
        });
        items.push({
            label: "$(beaker)  Run Coverage",
            action: "run-coverage",
        });
        items.push({
            label: "$(beaker)  Open Test Explorer",
            action: "open-tests",
        });
        items.push({
            label: "$(new-file)  Open or Create .covdbg.yaml",
            action: "create-config",
        });
        items.push({
            label: "$(trash)  Clear Last Run Result",
            action: "clear-last-run",
        });
        items.push({
            label: ctx.isCoverageEnabled ? "$(eye-closed)  Hide Coverage" : "$(eye)  Show Coverage",
            action: "toggle",
        });
        items.push({
            label: "$(settings-gear)  Settings",
            action: "settings",
        });
    } else {
        // ── Not-loaded state ──
        items.push({ label: "Setup", kind: vscode.QuickPickItemKind.Separator, action: "" });
        items.push({
            label: "$(folder-opened)  Select .covdb File…",
            detail: "    Set covdbg.covdbPath or place a .covdb in the workspace",
            action: "configure",
        });
        items.push({
            label: "$(new-file)  Create .covdbg.yaml",
            detail: "    Generate a starter config in a workspace folder",
            action: "create-config",
        });
        items.push({
            label: "$(beaker)  Run Coverage",
            action: "run-coverage",
        });
        items.push({
            label: "$(beaker)  Open Test Explorer",
            action: "open-tests",
        });
        items.push({
            label: "$(trash)  Clear Last Run Result",
            action: "clear-last-run",
        });
        items.push({
            label: "$(settings-gear)  Settings",
            action: "settings",
        });
    }

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "covdbg",
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked || !picked.action || picked.action === "noop") {
        return;
    }

    switch (picked.action) {
        case "toggle":
            actions.toggle();
            break;
        case "render-mode":
            if (picked.mode) {
                actions.setRenderMode(picked.mode);
            }
            break;
        case "browse":
            actions.browse();
            break;
        case "report":
            actions.showReport();
            break;
        case "configure":
            actions.configure();
            break;
        case "create-config":
            actions.createConfig();
            break;
        case "settings":
            actions.openSettings();
            break;
        case "switch-database":
            await showDatabaseSwitcher(ctx, actions);
            break;
        case "run-coverage":
            actions.runCoverage();
            break;
        case "clear-last-run":
            actions.clearLastRunResult();
            break;
        case "open-tests":
            actions.openTestsView();
            break;
    }
}

// ---------------------------------------------------------------------------
// Database switcher popup
// ---------------------------------------------------------------------------

async function showDatabaseSwitcher(ctx: MenuContext, actions: MenuActions): Promise<void> {
    interface DbItem extends vscode.QuickPickItem {
        covdbPath?: string;
        action?: string;
    }

    const items: DbItem[] = [];

    // Close current database
    items.push({
        label: "$(close)  Close Current Database",
        description: ctx.activeCovdbPath ? path.basename(ctx.activeCovdbPath) : "",
        action: "close",
    });

    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

    // Available .covdb files in the workspace
    for (const uri of ctx.availableCovdbFiles) {
        const isCurrent =
            ctx.activeCovdbPath &&
            path.normalize(uri.fsPath).toLowerCase() ===
                path.normalize(ctx.activeCovdbPath).toLowerCase();
        const display = vscode.workspace.workspaceFolders
            ? vscode.workspace.asRelativePath(uri.fsPath)
            : path.basename(uri.fsPath);
        items.push({
            label: `${isCurrent ? "$(check)" : "$(database)"}  ${display}`,
            description: isCurrent ? "active" : "",
            covdbPath: uri.fsPath,
            action: "switch",
        });
    }

    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

    // Browse for a file not in the workspace
    items.push({
        label: "$(folder-opened)  Browse for .covdb File…",
        action: "browse",
    });

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "covdbg — switch coverage database",
        matchOnDescription: true,
    });
    if (!picked || !picked.action) {
        return;
    }

    switch (picked.action) {
        case "close":
            actions.closeDatabase();
            break;
        case "switch":
            if (picked.covdbPath) {
                actions.switchDatabase(picked.covdbPath);
            }
            break;
        case "browse":
            actions.configure();
            break;
    }
}

// ---------------------------------------------------------------------------
// File browser popup
// ---------------------------------------------------------------------------

export async function showFileBrowser(fileIndex: Map<string, CovdbFileSummary>): Promise<void> {
    if (fileIndex.size === 0) {
        vscode.window.showInformationMessage("covdbg: No coverage files indexed.");
        return;
    }

    interface FileItem extends vscode.QuickPickItem {
        filePath: string;
    }

    const items: FileItem[] = Array.from(fileIndex.values())
        .sort((a, b) => a.filePath.localeCompare(b.filePath))
        .map((s) => {
            const pct = s.coveragePercent.toFixed(1);
            const icon =
                s.coveragePercent >= 80
                    ? "$(check)"
                    : s.coveragePercent >= 50
                      ? "$(warning)"
                      : "$(error)";
            const display = vscode.workspace.workspaceFolders
                ? vscode.workspace.asRelativePath(s.filePath)
                : path.basename(s.filePath);
            return {
                label: `${icon}  ${display}`,
                description: `${s.coveredLines}/${s.totalLines} — ${pct}%`,
                filePath: s.filePath,
            };
        });

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "covdbg — browse covered files",
        matchOnDescription: true,
    });
    if (picked) {
        try {
            const doc = await vscode.workspace.openTextDocument(picked.filePath);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        } catch {
            vscode.window.showWarningMessage(`Cannot open: ${picked.filePath}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeOverallStats(fileIndex: Map<string, CovdbFileSummary>): {
    covered: number;
    total: number;
} {
    let covered = 0,
        total = 0;
    for (const s of fileIndex.values()) {
        covered += s.coveredLines;
        total += s.totalLines;
    }
    return { covered, total };
}
