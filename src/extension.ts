import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { CoverageDecorator } from "./coverage/coverageDecorator";
import { RenderMode } from "./types";
import {
    CovdbParser,
    CovdbFileSummary,
    FileCoverage,
} from "./coverage/covdbParser";
import { StatusBar } from "./views/statusBar";
import { CoverageReport } from "./views/coverageReport";
import * as output from "./views/outputChannel";
import {
    showMenu as showMenuPopup,
    showFileBrowser as showFileBrowserPopup,
    MenuContext,
    MenuActions,
} from "./views/menuPopup";
import { runCoverageForTarget, runCoverageNow } from "./runner/runnerService";
import { logCovdbgResolution } from "./runner/runtimeInfo";
import { listDiscoveredExecutablePaths } from "./runner/workspaceDefaults";
import {
    LicenseStatusSnapshot,
    readLicenseStatus,
} from "./runner/licenseStatus";
import {
    getWorkspaceRoot,
    readRunnerSettings,
    resolveRunnerPaths,
} from "./runner/settings";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let decorator: CoverageDecorator;
let statusBar: StatusBar;
let report: CoverageReport;
/** The extension's install URI, used to resolve bundled assets. */
let extensionUri: vscode.Uri;

/** Path to the active .covdb file. */
let activeCovdbPath: string | undefined;
/** Timestamp (mtime ms) of the .covdb file when we last loaded the index. */
let activeCovdbMtime: number = 0;
/** File index from the .covdb (path -> summary stats). No line data. */
let fileIndex: Map<string, CovdbFileSummary> = new Map();
/** Per-file line-level coverage cache (populated lazily on editor open). */
let coverageCache: Map<string, FileCoverage> = new Map();
/** Maximum number of file coverages to keep in cache. */
const MAX_COVERAGE_CACHE_SIZE = 200;
/** Interval handle for timestamp polling. */
let pollTimer: ReturnType<typeof setInterval> | undefined;
/** Guard to prevent overlapping loadIndex calls. */
let isLoadingIndex = false;
/** Testing API controller for discovered binaries. */
let testingController: vscode.TestController | undefined;
/** Track last run output for clear command. */
let lastRunOutputPath: string | undefined;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    output.log("covdbg extension activated");

    extensionUri = context.extensionUri;
    decorator = new CoverageDecorator();
    statusBar = new StatusBar();
    report = new CoverageReport();

    // Restore persisted render mode (workspace state takes priority, then setting)
    const savedMode =
        context.workspaceState.get<RenderMode>("covdbg.renderMode");
    const configMode = vscode.workspace
        .getConfiguration("covdbg")
        .get<RenderMode>("renderMode", "line");
    const initialMode = savedMode ?? configMode;
    decorator.setRenderMode(initialMode);
    statusBar.setRenderMode(initialMode);

    context.subscriptions.push(
        vscode.commands.registerCommand("covdbg.showMenu", () =>
            showMenu(context),
        ),
        vscode.commands.registerCommand("covdbg.toggleCoverage", () =>
            toggleVisibility(),
        ),
        vscode.commands.registerCommand(
            "covdbg.showReport",
            showCoverageReportCommand,
        ),
        vscode.commands.registerCommand("covdbg.browseFiles", () =>
            showFileBrowser(),
        ),
        vscode.commands.registerCommand(
            "covdbg.setRenderMode",
            (mode: string) => applyRenderMode(mode as RenderMode, context),
        ),
        vscode.commands.registerCommand("covdbg.configurePath", () =>
            pickCovdbFile(),
        ),
        vscode.commands.registerCommand("covdbg.runCoverage", () =>
            runCoverageCommand(context),
        ),
        vscode.commands.registerCommand("covdbg.clearLastRunResult", () =>
            clearLastRunResultCommand(),
        ),
        vscode.commands.registerCommand("covdbg.refreshTestBinaries", () =>
            refreshTestControllerItems(),
        ),
    );

    // Decorate when switching editors
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                decorateEditor(editor);
            }
        }),
    );

    // Reload index when settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (
                e.affectsConfiguration("covdbg.covdbPath") ||
                e.affectsConfiguration("covdbg.showExternalFiles") ||
                e.affectsConfiguration("covdbg.discoveryPattern")
            ) {
                await discoverAndLoadIndex();
            }
            if (e.affectsConfiguration("covdbg.renderMode")) {
                const mode = vscode.workspace
                    .getConfiguration("covdbg")
                    .get<RenderMode>("renderMode", "line");
                decorator.setRenderMode(mode);
                statusBar.setRenderMode(mode);
                context.workspaceState.update("covdbg.renderMode", mode);
                refreshAllEditors();
            }
            if (
                e.affectsConfiguration("covdbg.runner.binaryDiscoveryPattern")
            ) {
                await refreshTestControllerItems();
            }
            if (
                e.affectsConfiguration("covdbg.runner.appDataPath") ||
                e.affectsConfiguration("covdbg.runner.env")
            ) {
                await refreshLicenseStatusFromDisk();
            }
        }),
    );

    // Ensure poll timer is cleaned up on extension dispose
    context.subscriptions.push({
        dispose: () => {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = undefined;
            }
        },
    });

    initializeTestingController(context);
    statusBar.setIdle();
    void refreshLicenseStatusFromDisk();
    void logCovdbgResolution(context);
    discoverAndLoadIndex();
}

export function deactivate(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
    }
    testingController?.dispose();
    decorator?.dispose();
    statusBar?.dispose();
    report?.dispose();
    output.dispose();
}

// ---------------------------------------------------------------------------
// Discovery & index loading
// ---------------------------------------------------------------------------

async function discoverAndLoadIndex(): Promise<void> {
    const config = vscode.workspace.getConfiguration("covdbg");

    // 1. Explicit path from settings
    const explicit = config.get<string>("covdbPath", "").trim();
    if (explicit) {
        const resolved = resolveWorkspacePath(explicit);
        if (await fileExists(resolved)) {
            await loadIndex(resolved, "settings");
            return;
        }
        output.logError(`covdbg.covdbPath not found: ${resolved}`);
    }

    // 2. Auto-discover in workspace
    const pattern = config.get<string>("discoveryPattern", "**/*.covdb");
    const found = await vscode.workspace.findFiles(pattern, undefined, 50);
    if (found.length > 0) {
        const newest = await getMostRecentFile(found);
        if (newest) {
            await loadIndex(newest.fsPath, "auto-discovered");
            return;
        }
    }
}

async function loadIndex(
    covdbPath: string,
    source: "settings" | "auto-discovered" = "settings",
): Promise<void> {
    if (isLoadingIndex) {
        return;
    }
    isLoadingIndex = true;
    try {
        const mtime = await getMtime(covdbPath);
        output.log(`Loading index from: ${covdbPath} (${source})`);

        const result = await CovdbParser.loadIndex(covdbPath);
        if (result.error) {
            vscode.window.showErrorMessage(`covdbg: ${result.error}`);
            return;
        }
        if (result.files.size === 0) {
            vscode.window.showWarningMessage(
                "covdbg: No coverage data in .covdb",
            );
            return;
        }

        activeCovdbPath = covdbPath;
        activeCovdbMtime = mtime;
        const showExternal = vscode.workspace
            .getConfiguration("covdbg")
            .get<boolean>("showExternalFiles", false);
        fileIndex = showExternal
            ? result.files
            : filterToWorkspaceFiles(result.files);
        coverageCache.clear();
        report.clearFunctionIndex();

        statusBar.setLoaded();
        const excluded = result.files.size - fileIndex.size;
        const excludedMsg =
            excluded > 0 ? ` (${excluded} external files hidden)` : "";
        output.log(
            `Indexed ${fileIndex.size} files${excludedMsg} (mtime ${mtime})`,
        );

        // Decorate any already-open editors
        refreshAllEditors();
        report.update(fileIndex, activeCovdbPath);

        // Start polling the .covdb file for timestamp changes
        startTimestampPolling();
    } finally {
        isLoadingIndex = false;
    }
}

// ---------------------------------------------------------------------------
// Timestamp polling — reload index when .covdb changes on disk
// ---------------------------------------------------------------------------

function startTimestampPolling(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
    }
    pollTimer = setInterval(() => checkCovdbTimestamp(), 2000);
}

async function checkCovdbTimestamp(): Promise<void> {
    if (!activeCovdbPath) {
        return;
    }
    const mtime = await getMtime(activeCovdbPath);
    if (mtime > 0 && mtime !== activeCovdbMtime) {
        output.log(`.covdb changed on disk, reloading index`);
        await loadIndex(activeCovdbPath);
    }
}

// ---------------------------------------------------------------------------
// Lazy per-file loading
// ---------------------------------------------------------------------------

/**
 * Find the covdb key that matches an editor path, using case-insensitive
 * and suffix matching. Single pass with priority: exact > suffix > basename.
 */
function findIndexKey(editorPath: string): string | undefined {
    const normEditor = path.normalize(editorPath).toLowerCase();
    const basename = path.basename(editorPath).toLowerCase();

    let suffixMatch: string | undefined;
    let basenameMatch: string | undefined;

    for (const key of fileIndex.keys()) {
        const normKey = path.normalize(key).toLowerCase();

        // Exact match — return immediately
        if (normKey === normEditor) {
            return key;
        }
        // Suffix match — keep first hit but continue looking for exact
        if (
            !suffixMatch &&
            (normEditor.endsWith(normKey) || normKey.endsWith(normEditor))
        ) {
            suffixMatch = key;
        }
        // Basename match — lowest priority
        if (!basenameMatch && path.basename(key).toLowerCase() === basename) {
            basenameMatch = key;
        }
    }

    return suffixMatch ?? basenameMatch;
}

async function getOrLoadCoverage(
    editorPath: string,
): Promise<FileCoverage | undefined> {
    if (!activeCovdbPath) {
        return undefined;
    }

    const key = findIndexKey(editorPath);
    if (!key) {
        return undefined;
    }

    // Return cached data if available (re-insert to refresh LRU order)
    const cached = coverageCache.get(key);
    if (cached) {
        coverageCache.delete(key);
        coverageCache.set(key, cached);
        return cached;
    }

    // Query the .covdb for just this file
    const result = await CovdbParser.loadFileCoverage(activeCovdbPath, key);
    if (result.coverage) {
        // Evict oldest entry if cache is full
        if (coverageCache.size >= MAX_COVERAGE_CACHE_SIZE) {
            const oldestKey = coverageCache.keys().next().value!;
            coverageCache.delete(oldestKey);
        }
        coverageCache.set(key, result.coverage);
        return result.coverage;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

/** Apply coverage decorations to a single editor, loading data lazily. */
async function decorateEditor(editor: vscode.TextEditor): Promise<void> {
    if (!decorator.isDisplayEnabled()) {
        return;
    }

    const coverage = await getOrLoadCoverage(editor.document.uri.fsPath);
    if (coverage) {
        decorator.applyDecorations(editor, coverage);
    } else {
        decorator.clearDecorations(editor);
    }
}

/** Re-apply decorations to all currently visible editors. */
function refreshAllEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        decorateEditor(editor);
    }
}

// ---------------------------------------------------------------------------
// Main menu (status bar click)
// ---------------------------------------------------------------------------

async function showMenu(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const key = editor ? findIndexKey(editor.document.uri.fsPath) : undefined;
    const activeFileSummary = key ? fileIndex.get(key) : undefined;

    // Discover available .covdb files for the switcher
    const config = vscode.workspace.getConfiguration("covdbg");
    const pattern = config.get<string>("discoveryPattern", "**/*.covdb");
    const availableCovdbFiles = await vscode.workspace.findFiles(
        pattern,
        undefined,
        50,
    );

    const ctx: MenuContext = {
        isLoaded: statusBar.isLoaded(),
        isCoverageEnabled: statusBar.isCoverageEnabled(),
        activeCovdbPath,
        fileIndex,
        currentRenderMode: decorator.getRenderMode(),
        activeFileSummary,
        availableCovdbFiles,
    };

    const actions: MenuActions = {
        toggle: () => toggleVisibility(),
        setRenderMode: (mode) => applyRenderMode(mode, context),
        browse: () => showFileBrowser(),
        showReport: () => showCoverageReportCommand(),
        configure: () => pickCovdbFile(),
        openSettings: () =>
            vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "covdbg",
            ),
        switchDatabase: (covdbPath) => loadIndex(covdbPath, "settings"),
        closeDatabase: () => closeCovdb(),
        runCoverage: () => runCoverageCommand(context),
        clearLastRunResult: () => clearLastRunResultCommand(),
        openTestsView: () =>
            vscode.commands.executeCommand("workbench.view.testing.focus"),
    };

    await showMenuPopup(ctx, actions);
}

// ---------------------------------------------------------------------------
// Commands — toggle, browse, render mode, configure, close
// ---------------------------------------------------------------------------

/** Toggle coverage overlay visibility on/off. */
function toggleVisibility(): void {
    const nowEnabled = statusBar.toggleCoverage();
    decorator.setEnabled(nowEnabled);
    if (nowEnabled) {
        refreshAllEditors();
    } else {
        vscode.window.visibleTextEditors.forEach((e) =>
            decorator.clearDecorations(e),
        );
    }
}

/** Unload the current .covdb and clear all state. */
function closeCovdb(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
    }
    activeCovdbPath = undefined;
    activeCovdbMtime = 0;
    fileIndex = new Map();
    coverageCache.clear();
    report.clearFunctionIndex();
    statusBar.setIdle();
    vscode.window.visibleTextEditors.forEach((e) =>
        decorator.clearDecorations(e),
    );
    output.log("Coverage database closed");
}

async function showFileBrowser(): Promise<void> {
    await showFileBrowserPopup(fileIndex);
}

async function applyRenderMode(
    mode: RenderMode,
    context: vscode.ExtensionContext,
): Promise<void> {
    decorator.setRenderMode(mode);
    statusBar.setRenderMode(mode);
    context.workspaceState.update("covdbg.renderMode", mode);
    // Keep the VS Code setting in sync so the Settings UI reflects the current mode
    const config = vscode.workspace.getConfiguration("covdbg");
    await config.update(
        "renderMode",
        mode,
        vscode.ConfigurationTarget.Workspace,
    );
    refreshAllEditors();
}

async function pickCovdbFile(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "Coverage Database": ["covdb"] },
        title: "Select .covdb file",
    });
    if (result && result.length > 0) {
        const config = vscode.workspace.getConfiguration("covdbg");
        await config.update(
            "covdbPath",
            result[0].fsPath,
            vscode.ConfigurationTarget.Workspace,
        );
    }
}

async function runCoverageCommand(
    context: vscode.ExtensionContext,
): Promise<void> {
    const result = await runCoverageNow(
        context,
        () => statusBar.setRunning(),
        (ok) => (ok ? statusBar.setRunSucceeded() : statusBar.setRunFailed()),
    );
    await handleLicenseStatusUpdate(
        context,
        result.licenseStatus,
        result.success,
    );
    if (result.success && result.outputPath) {
        lastRunOutputPath = result.outputPath;
        if (await fileExists(result.outputPath)) {
            await loadIndex(result.outputPath, "settings");
            return;
        }
        await discoverAndLoadIndex();
    }
}

async function refreshLicenseStatusFromDisk(): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        statusBar.setLicenseStatus(undefined);
        return;
    }

    const settings = readRunnerSettings();
    const paths = resolveRunnerPaths(settings, workspaceRoot);
    const licenseStatus = await readLicenseStatus(paths.appDataPath);
    statusBar.setLicenseStatus(licenseStatus);
}

async function handleLicenseStatusUpdate(
    context: vscode.ExtensionContext,
    licenseStatus: LicenseStatusSnapshot | undefined,
    runSucceeded: boolean,
): Promise<void> {
    statusBar.setLicenseStatus(licenseStatus);
    if (!licenseStatus || licenseStatus.source !== "plugin-demo") {
        return;
    }

    if (licenseStatus.status === "active" && licenseStatus.isFirstIssue) {
        const noticeKey = "covdbg.demoNoticeShown";
        if (!context.globalState.get<boolean>(noticeKey)) {
            const daysRemaining = Math.max(
                0,
                licenseStatus.daysRemaining ?? 30,
            );
            await context.globalState.update(noticeKey, true);
            void vscode.window.showInformationMessage(
                `covdbg: The VS Code edition can be used free for 30 days. ${daysRemaining} day(s) remaining.`,
            );
        }
        return;
    }

    if (!runSucceeded && licenseStatus.status === "trial-used") {
        void vscode.window.showWarningMessage(
            licenseStatus.message ||
                "covdbg: The 30-day demo has already been used on this machine.",
        );
    }
}

async function clearLastRunResultCommand(): Promise<void> {
    const toDelete = lastRunOutputPath;
    closeCovdb();
    statusBar.clearLastRunResult();

    if (toDelete && (await fileExists(toDelete))) {
        try {
            await fs.unlink(toDelete);
            output.log(`Cleared last run result: ${toDelete}`);
            vscode.window.showInformationMessage(
                "covdbg: Last run result cleared.",
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            output.logError(`Failed to clear last run result: ${message}`);
            vscode.window.showWarningMessage(
                `covdbg: Failed to delete last .covdb: ${message}`,
            );
        }
    } else {
        output.log("Cleared UI state for last run result.");
        vscode.window.showInformationMessage("covdbg: Cleared last run state.");
    }
    lastRunOutputPath = undefined;
}

// ---------------------------------------------------------------------------
// Coverage Report command
// ---------------------------------------------------------------------------

async function showCoverageReportCommand(): Promise<void> {
    await report.show(fileIndex, activeCovdbPath, extensionUri);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a potentially relative path against the first workspace folder. */
function resolveWorkspacePath(p: string): string {
    if (path.isAbsolute(p)) {
        return p;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.resolve(root, p) : p;
}

async function getMostRecentFile(
    files: vscode.Uri[],
): Promise<vscode.Uri | undefined> {
    let newest: vscode.Uri | undefined;
    let best = 0;
    for (const f of files) {
        const mt = await getMtime(f.fsPath);
        if (mt > best) {
            best = mt;
            newest = f;
        }
    }
    return newest;
}

async function getMtime(filePath: string): Promise<number> {
    try {
        return (await fs.stat(filePath)).mtimeMs;
    } catch {
        return 0;
    }
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

function initializeTestingController(context: vscode.ExtensionContext): void {
    testingController = vscode.tests.createTestController(
        "covdbg.testController",
        "covdbg binaries",
    );
    context.subscriptions.push(testingController);

    testingController.createRunProfile(
        "Run with Coverage",
        vscode.TestRunProfileKind.Run,
        (request, token) => runCoverageFromTestRequest(request, token, context),
        true,
    );

    void refreshTestControllerItems();
}

async function refreshTestControllerItems(): Promise<void> {
    if (!testingController) {
        return;
    }
    testingController.items.replace([]);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return;
    }
    const binaries = await listDiscoveredExecutablePaths(workspaceRoot);
    for (const binaryPath of binaries) {
        const id = path.normalize(binaryPath).toLowerCase();
        const item = testingController.createTestItem(
            id,
            path.basename(binaryPath),
            vscode.Uri.file(binaryPath),
        );
        item.description = vscode.workspace.asRelativePath(binaryPath);
        item.canResolveChildren = false;
        testingController.items.add(item);
    }
    output.log(`Testing API: discovered ${binaries.length} binaries.`);
}

async function runCoverageFromTestRequest(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    context: vscode.ExtensionContext,
): Promise<void> {
    if (!testingController) {
        return;
    }
    const run = testingController.createTestRun(request);
    const targets = collectRequestedTests(request, testingController);
    if (targets.length === 0) {
        run.end();
        return;
    }

    for (const item of targets) {
        if (token.isCancellationRequested) {
            run.skipped(item);
            continue;
        }
        run.started(item);
        statusBar.setRunning();
        const result = await runCoverageForTarget(
            context,
            item.uri?.fsPath ?? item.id,
            undefined,
            (ok) =>
                ok ? statusBar.setRunSucceeded() : statusBar.setRunFailed(),
        );
        if (result.success) {
            if (result.outputPath) {
                lastRunOutputPath = result.outputPath;
            }
            run.passed(item);
            if (result.outputPath && (await fileExists(result.outputPath))) {
                await loadIndex(result.outputPath, "settings");
            } else {
                await discoverAndLoadIndex();
            }
        } else {
            run.failed(item, new vscode.TestMessage("Coverage run failed"));
        }
    }
    run.end();
}

function collectRequestedTests(
    request: vscode.TestRunRequest,
    controller: vscode.TestController,
): vscode.TestItem[] {
    if (request.include && request.include.length > 0) {
        return [...request.include];
    }
    const all: vscode.TestItem[] = [];
    controller.items.forEach((item) => all.push(item));
    return all;
}

/**
 * Filter a file index to only include files reachable from a workspace folder.
 * Removes SDK headers, system includes, and other external paths.
 */
function filterToWorkspaceFiles(
    files: Map<string, CovdbFileSummary>,
): Map<string, CovdbFileSummary> {
    const roots = vscode.workspace.workspaceFolders?.map((f) =>
        path.normalize(f.uri.fsPath).toLowerCase(),
    );
    if (!roots || roots.length === 0) {
        return files; // no workspace open — keep everything
    }
    const filtered = new Map<string, CovdbFileSummary>();
    for (const [key, summary] of files) {
        const norm = path.normalize(key).toLowerCase();
        if (roots.some((root) => norm.startsWith(root))) {
            filtered.set(key, summary);
        }
    }
    return filtered;
}
