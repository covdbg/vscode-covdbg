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
import {
    buildCoverageSummaryFromFileIndex,
    emptyCoverageSummary,
    type CoverageSummary,
} from "./coverage/coverageSummary";
import {
    buildExploreUncoveredFilesResult,
    ExploreUncoveredFilesInput,
    ExploreUncoveredFilesResult,
} from "./coverage/exploreUncoveredFiles";
import {
    buildUncoveredCodeResult,
    emptyUncoveredCodeResult,
    UncoveredCodeResult,
} from "./coverage/uncoveredCode";
import {
    buildNoActiveCoverageExploreGuidance,
    buildNoCoverageLoadedGuidance,
} from "./coverage/toolGuidance";
import { CovdbReloadScheduler } from "./coverage/covdbReloadScheduler";
import { runTestWithCoverageWorkflow } from "./coverage/runTestWithCoverageWorkflow";
import { findBestCoverageKey } from "./coverage/coverageKeyMatcher";
import { StatusBar } from "./views/statusBar";
import { CoverageReport } from "./views/coverageReport";
import * as output from "./views/outputChannel";
import {
    showMenu as showMenuPopup,
    showFileBrowser as showFileBrowserPopup,
    MenuContext,
    MenuActions,
} from "./views/menuPopup";
import {
    CovdbgSidebarController,
    SidebarCoverageState,
} from "./views/sidebar";
import {
    analyzeCoverageBinaries,
    mergeCoverageFiles,
    runCoverageForTarget,
} from "./runner/runnerService";
import {
    listDiscoveredExecutablePaths,
} from "./runner/workspaceDefaults";
import {
    LicenseStatusSnapshot,
} from "./runner/licenseStatus";
import {
    resolveAnalyzeInputsForTarget,
} from "./runner/analyzeInputs";
import {
    getPreferredWorkspaceFolder,
    resolvePathFromWorkspace,
    readRunnerSettings,
    resolveRunnerPaths,
    getWorkspaceRoot,
} from "./runner/settings";
import {
    dedupeNormalizedPaths,
    deriveCoverageBatchOutputPath,
} from "./runner/outputPaths";
import {
    EXPLORE_UNCOVERED_FILES_TOOL_NAME,
    ExploreUncoveredFilesTool,
} from "./tools/exploreUncoveredFilesTool";
import {
    GET_UNCOVERED_CODE_TOOL_NAME,
    GetUncoveredCodeTool,
} from "./tools/getUncoveredCodeTool";
import {
    RunTestWithCoverageTool,
} from "./tools/runTestWithCoverageTool";
import {
    RUN_TEST_WITH_COVERAGE_TOOL_NAME,
    type RunTestWithCoverageToolResult,
} from "./tools/runTestWithCoverageModel";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let decorator: CoverageDecorator;
let statusBar: StatusBar;
let report: CoverageReport;
let sidebar: CovdbgSidebarController;
/** The extension's install URI, used to resolve bundled assets. */
let extensionUri: vscode.Uri;

/** Path to the active .covdb file. */
/** Maximum number of file coverages to keep in cache. */
const MAX_COVERAGE_CACHE_SIZE = 200;
/** Guard to prevent overlapping loadIndex calls. */
let isLoadingIndex = false;
/** Guard to prevent overlapping queued covdb reload flushes. */
let isFlushingPendingCovdbReloads = false;
/** Testing API controller for discovered binaries. */
let testingController: vscode.TestController | undefined;
/** Root item shown in the Testing view. */
let testingRootItem: vscode.TestItem | undefined;
/** Executable path lookup for file-less test items. */
const testExecutablePaths: Map<string, string> = new Map();
const covdbReloadScheduler = new CovdbReloadScheduler();
const covdbWatchers = new Map<
    string,
    { covdbPath: string; watcher: vscode.FileSystemWatcher }
>();
let lastDiscoveredTestBinaryIds: string | undefined;
/** Track last run output for clear command. */
let lastRunOutputPaths: string[] = [];
let setupPromptInFlight = false;

const CONFIG_PROMPT_ACK_KEY = "covdbg.createConfigPromptAcknowledged";
const CONFIG_FILE_NAME = ".covdbg.yaml";
const CONFIG_FILE_GLOB = `**/${CONFIG_FILE_NAME}`;
const DISCOVERY_EXCLUDE_GLOB = "**/{.git,node_modules,.vscode,assets}/**";
const MAX_DISCOVERED_COVDB_FILES = 50;

interface CoverageWorkspaceState {
    workspaceFolder?: vscode.WorkspaceFolder;
    activeCovdbPath?: string;
    activeCovdbMtime: number;
    fileIndex: Map<string, CovdbFileSummary>;
    coverageCache: Map<string, FileCoverage>;
    staleCoverageKeys: Set<string>;
}

interface UncoveredCodeCacheEntry {
    covdbPath?: string;
    covdbMtime: number;
    documentVersion: number;
    result: UncoveredCodeResult;
}

const coverageStates = new Map<string, CoverageWorkspaceState>();
const uncoveredCodeCache = new Map<string, UncoveredCodeCacheEntry>();

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    output.log("covdbg extension activated");

    extensionUri = context.extensionUri;
    decorator = new CoverageDecorator();
    statusBar = new StatusBar();
    report = new CoverageReport();
    sidebar = new CovdbgSidebarController(context, {
        createConfig: () => createConfigCommand(context),
        createConfigInWorkspace: (workspaceFolder) =>
            createConfigInWorkspace(context, workspaceFolder),
        discoverAndLoadIndex: () => discoverAndLoadIndex(context),
        findCovdbgConfigFiles,
        findDiscoveredCovdbFiles,
        getActiveCoverageState,
        getWorkspaceCoverageState,
        getWorkspaceFolderForPath,
        loadIndex,
        refreshTestControllerItems,
        setLicenseStatus: (licenseStatus) =>
            statusBar.setLicenseStatus(licenseStatus),
    });

    // Restore persisted render mode (workspace state takes priority, then setting)
    const savedMode =
        context.workspaceState.get<RenderMode>("covdbg.renderMode");
    const configMode = vscode.workspace
        .getConfiguration("covdbg")
        .get<RenderMode>("renderMode", "gutter");
    const initialMode = savedMode ?? configMode;
    decorator.setRenderMode(initialMode);
    statusBar.setRenderMode(initialMode);

    context.subscriptions.push(
        sidebar,
        ...sidebar.getDisposables(),
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
        vscode.commands.registerCommand("covdbg.createConfig", () =>
            createConfigCommand(context),
        ),
        vscode.commands.registerCommand("covdbg.runCoverage", () =>
            runCoverageCommand(context),
        ),
        vscode.commands.registerCommand(
            "covdbg.getUncoveredCode",
            (filePath?: string) => getUncoveredCode(filePath),
        ),
        vscode.commands.registerCommand("covdbg.clearLastRunResult", () =>
            clearLastRunResultCommand(),
        ),
        vscode.commands.registerCommand("covdbg.refreshTestBinaries", () =>
            refreshTestControllerItems(),
        ),
        vscode.lm.registerTool(
            GET_UNCOVERED_CODE_TOOL_NAME,
            new GetUncoveredCodeTool(getUncoveredCode),
        ),
        vscode.lm.registerTool(
            EXPLORE_UNCOVERED_FILES_TOOL_NAME,
            new ExploreUncoveredFilesTool(exploreUncoveredFiles),
        ),
        vscode.lm.registerTool(
            RUN_TEST_WITH_COVERAGE_TOOL_NAME,
            new RunTestWithCoverageTool((executablePaths) =>
                runTestWithCoverage(context, executablePaths),
            ),
        ),
    );

    // Decorate when switching editors
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                void decorateEditor(editor);
            }
            updateActiveWorkspaceUi();
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length === 0) {
                return;
            }
            invalidateCoverageForDocument(event.document);
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
                await discoverAndLoadIndex(context);
            }
            if (e.affectsConfiguration("covdbg.renderMode")) {
                const mode = vscode.workspace
                    .getConfiguration("covdbg")
                    .get<RenderMode>("renderMode", "gutter");
                decorator.setRenderMode(mode);
                statusBar.setRenderMode(mode);
                context.workspaceState.update("covdbg.renderMode", mode);
                refreshAllEditors();
            }
            if (
                e.affectsConfiguration("covdbg.runner.binaryDiscoveryPattern")
                || e.affectsConfiguration("covdbg.runner.binaryDiscoveryExcludePattern")
            ) {
                await refreshTestControllerItems();
            }
            if (
                e.affectsConfiguration("covdbg.executablePath") ||
                e.affectsConfiguration("covdbg.portableCachePath")
            ) {
                await sidebar.refreshRuntimeSummary();
            }
            if (
                e.affectsConfiguration("covdbg.runner.appDataPath") ||
                e.affectsConfiguration("covdbg.runner.env")
            ) {
                await sidebar.refreshLicenseStatusFromDisk();
            }
            sidebar.scheduleRefresh();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void refreshTestControllerItems();
            void discoverAndLoadIndex(context);
            sidebar.scheduleRefresh();
        }),
    );

    const configWatcher = vscode.workspace.createFileSystemWatcher(
        CONFIG_FILE_GLOB,
    );
    context.subscriptions.push(
        configWatcher,
        configWatcher.onDidCreate((uri) => {
            void handleCovdbgConfigFileChange(context, uri);
        }),
        configWatcher.onDidChange((uri) => {
            void handleCovdbgConfigFileChange(context, uri);
        }),
        configWatcher.onDidDelete((uri) => {
            void handleCovdbgConfigFileChange(context, uri, true);
        }),
    );

    context.subscriptions.push({
        dispose: () => disposeAllCovdbWatchers(),
    });

    initializeTestingController(context);
    statusBar.setIdle();
    sidebar.scheduleRefresh();
    void sidebar.refreshLicenseStatusFromDisk();
    void sidebar.refreshRuntimeSummary();
    void discoverAndLoadIndex(context);
}

export function deactivate(): void {
    disposeAllCovdbWatchers();
    testingController?.dispose();
    decorator?.dispose();
    statusBar?.dispose();
    report?.dispose();
    sidebar?.dispose();
    output.dispose();
}

// ---------------------------------------------------------------------------
// Discovery & index loading
// ---------------------------------------------------------------------------

async function discoverAndLoadIndex(
    context?: vscode.ExtensionContext,
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let anyLoaded = false;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        const explicitCandidates = await getExplicitCovdbCandidates();
        if (explicitCandidates.length > 0) {
            const newestExplicit = await getMostRecentPath(explicitCandidates);
            if (newestExplicit) {
                await loadIndex(newestExplicit, "settings");
                anyLoaded = true;
            }
        }

        if (!anyLoaded) {
            const found = await findDiscoveredCovdbFiles();
            if (found.length > 0) {
                const newest = await getMostRecentFile(found);
                if (newest) {
                    await loadIndex(newest.fsPath, "auto-discovered");
                    anyLoaded = true;
                }
            }
        }
    } else {
        for (const folder of workspaceFolders) {
            const explicitCandidate = await getExplicitCovdbCandidateForFolder(folder);
            if (explicitCandidate) {
                await loadIndex(explicitCandidate, "settings", folder);
                anyLoaded = true;
                continue;
            }

            const discoveredFiles = await findDiscoveredCovdbFiles(folder);
            const newest = await getMostRecentFile(discoveredFiles);
            if (newest) {
                await loadIndex(newest.fsPath, "auto-discovered", folder);
                anyLoaded = true;
            } else {
                clearCoverageState(folder, false);
            }
        }
        pruneCoverageStates(workspaceFolders);
    }

    updateActiveWorkspaceUi();
    void flushPendingCovdbReloads();

    if (!anyLoaded && context) {
        await maybeOfferToCreateConfig(context, false);
    }
}

async function loadIndex(
    covdbPath: string,
    source: "settings" | "auto-discovered" = "settings",
    workspaceFolder?: vscode.WorkspaceFolder,
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

        const targetWorkspaceFolder =
            workspaceFolder ?? getWorkspaceFolderForPath(covdbPath);
        const state = getOrCreateCoverageState(targetWorkspaceFolder);
        state.activeCovdbPath = covdbPath;
        state.activeCovdbMtime = mtime;
        ensureCovdbWatcher(state);
        const showExternal = vscode.workspace
            .getConfiguration("covdbg", targetWorkspaceFolder?.uri)
            .get<boolean>("showExternalFiles", false);
        state.fileIndex = showExternal
            ? result.files
            : filterToWorkspaceFiles(result.files, targetWorkspaceFolder);
        state.coverageCache.clear();
        state.staleCoverageKeys.clear();
        uncoveredCodeCache.clear();

        const excluded = result.files.size - state.fileIndex.size;
        const excludedMsg =
            excluded > 0 ? ` (${excluded} external files hidden)` : "";
        output.log(
            `Indexed ${state.fileIndex.size} files${excludedMsg} (mtime ${mtime})`,
        );

        refreshAllEditors();
        updateActiveWorkspaceUi();
        void flushPendingCovdbReloads();
    } finally {
        isLoadingIndex = false;
        if (!covdbReloadScheduler.hasActiveExecution()) {
            void flushPendingCovdbReloads();
        }
    }
}

// ---------------------------------------------------------------------------
// Event-driven .covdb watching — defer reloads until workflows are idle
// ---------------------------------------------------------------------------

function ensureCovdbWatcher(state: CoverageWorkspaceState): void {
    const stateKey = getWorkspaceStateKey(state.workspaceFolder);
    const covdbPath = state.activeCovdbPath;
    const existing = covdbWatchers.get(stateKey);

    if (!covdbPath) {
        disposeCovdbWatcher(stateKey);
        return;
    }

    if (
        existing &&
        normalizePathKey(existing.covdbPath) === normalizePathKey(covdbPath)
    ) {
        return;
    }

    disposeCovdbWatcher(stateKey);

    const filePattern = new vscode.RelativePattern(
        path.dirname(covdbPath),
        path.basename(covdbPath),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(filePattern);
    const queueReload = (uri: vscode.Uri) => {
        queueCovdbReload(stateKey, uri.fsPath);
    };

    watcher.onDidCreate(queueReload);
    watcher.onDidChange(queueReload);
    watcher.onDidDelete((uri) => {
        output.log(`covdbg file watcher noticed deletion: ${uri.fsPath}`);
    });

    covdbWatchers.set(stateKey, { covdbPath, watcher });
}

function disposeCovdbWatcher(stateKey: string): void {
    const existing = covdbWatchers.get(stateKey);
    if (!existing) {
        return;
    }

    existing.watcher.dispose();
    covdbWatchers.delete(stateKey);
}

function disposeAllCovdbWatchers(): void {
    for (const stateKey of covdbWatchers.keys()) {
        disposeCovdbWatcher(stateKey);
    }
}

function queueCovdbReload(stateKey: string, covdbPath: string): void {
    covdbReloadScheduler.queueReload(stateKey, covdbPath);
    if (covdbReloadScheduler.hasActiveExecution()) {
        output.log(
            `Queued .covdb reload until current coverage workflow completes: ${covdbPath}`,
        );
        return;
    }

    void flushPendingCovdbReloads();
}

async function flushPendingCovdbReloads(): Promise<void> {
    if (
        isFlushingPendingCovdbReloads ||
        isLoadingIndex ||
        covdbReloadScheduler.hasActiveExecution()
    ) {
        return;
    }

    isFlushingPendingCovdbReloads = true;
    try {
        const pendingReloads = covdbReloadScheduler.drainPendingReloads(
            getActiveCovdbPathsByState(),
        );

        for (const pending of pendingReloads) {
            if (covdbReloadScheduler.hasActiveExecution()) {
                covdbReloadScheduler.queueReload(
                    pending.stateKey,
                    pending.covdbPath,
                );
                break;
            }

            const state = coverageStates.get(pending.stateKey);
            if (!state?.activeCovdbPath) {
                continue;
            }

            const mtime = await getMtime(pending.covdbPath);
            if (mtime <= 0 || mtime === state.activeCovdbMtime) {
                continue;
            }

            output.log(
                `.covdb changed on disk, reloading index: ${pending.covdbPath}`,
            );
            await loadIndex(pending.covdbPath, "settings", state.workspaceFolder);
        }
    } finally {
        isFlushingPendingCovdbReloads = false;
        if (
            !isLoadingIndex &&
            !covdbReloadScheduler.hasActiveExecution() &&
            covdbReloadScheduler.hasPendingReloads()
        ) {
            void flushPendingCovdbReloads();
        }
    }
}

async function withDeferredCovdbReloads<T>(
    operation: () => Promise<T>,
): Promise<T> {
    covdbReloadScheduler.beginExecution();
    try {
        return await operation();
    } finally {
        covdbReloadScheduler.endExecution();
        void flushPendingCovdbReloads();
    }
}

function getActiveCovdbPathsByState(): Map<string, string> {
    const activeCovdbPaths = new Map<string, string>();
    for (const [stateKey, state] of coverageStates) {
        if (state.activeCovdbPath) {
            activeCovdbPaths.set(stateKey, state.activeCovdbPath);
        }
    }

    return activeCovdbPaths;
}

function normalizePathKey(filePath: string): string {
    return path.normalize(filePath).toLowerCase();
}

// ---------------------------------------------------------------------------
// Lazy per-file loading
// ---------------------------------------------------------------------------

/**
 * Find the covdb key that matches an editor path, using case-insensitive
 * and suffix matching. Single pass with priority: exact > suffix > basename.
 */
function findIndexKey(editorPath: string): string | undefined {
    const state = getCoverageStateForPath(editorPath);
    if (!state) {
        return undefined;
    }

    return findBestCoverageKey(
        editorPath,
        state.fileIndex.keys(),
        state.workspaceFolder?.uri.fsPath,
    );
}

async function getOrLoadCoverage(
    editorPath: string,
): Promise<FileCoverage | undefined> {
    const state = getCoverageStateForPath(editorPath);
    if (!state?.activeCovdbPath) {
        return undefined;
    }

    const key = findIndexKey(editorPath);
    if (!key) {
        return undefined;
    }
    if (await isCoverageStaleForPath(editorPath, key, state)) {
        return undefined;
    }

    // Return cached data if available (re-insert to refresh LRU order)
    const cached = state.coverageCache.get(key);
    if (cached) {
        state.coverageCache.delete(key);
        state.coverageCache.set(key, cached);
        return cached;
    }

    // Query the .covdb for just this file
    const result = await CovdbParser.loadFileCoverage(state.activeCovdbPath, key);
    if (result.coverage) {
        // Evict oldest entry if cache is full
        if (state.coverageCache.size >= MAX_COVERAGE_CACHE_SIZE) {
            const oldestKey = state.coverageCache.keys().next().value!;
            state.coverageCache.delete(oldestKey);
        }
        state.coverageCache.set(key, result.coverage);
        return result.coverage;
    }
    return undefined;
}

async function isCoverageStaleForPath(
    editorPath: string,
    key: string,
    state: CoverageWorkspaceState,
): Promise<boolean> {
    if (state.staleCoverageKeys.has(key)) {
        return true;
    }

    const openDocument = vscode.workspace.textDocuments.find(
        (document) =>
            document.uri.scheme === "file" &&
            path.normalize(document.uri.fsPath).toLowerCase() ===
            path.normalize(editorPath).toLowerCase(),
    );
    if (openDocument?.isDirty) {
        return true;
    }

    if (state.activeCovdbMtime <= 0) {
        return false;
    }

    const sourceMtime = await getMtime(editorPath);
    return sourceMtime > 0 && sourceMtime > state.activeCovdbMtime;
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

function invalidateCoverageForDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file") {
        return;
    }

    const state = getCoverageStateForPath(document.uri.fsPath);
    if (!state) {
        return;
    }

    const key = findIndexKey(document.uri.fsPath);
    if (!key) {
        return;
    }

    state.coverageCache.delete(key);
    state.staleCoverageKeys.add(key);
    uncoveredCodeCache.delete(getUncoveredCodeCacheKey(document.uri.fsPath));

    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.fsPath === document.uri.fsPath) {
            decorator.clearDecorations(editor);
        }
    }
}

// ---------------------------------------------------------------------------
// Main menu (status bar click)
// ---------------------------------------------------------------------------

async function showMenu(context: vscode.ExtensionContext): Promise<void> {
    const activeState = getActiveCoverageState();
    const editor = vscode.window.activeTextEditor;
    const key = editor ? findIndexKey(editor.document.uri.fsPath) : undefined;
    const activeFileSummary = key ? activeState?.fileIndex.get(key) : undefined;

    // Discover available .covdb files for the switcher
    const availableCovdbFiles = await findDiscoveredCovdbFiles();

    const ctx: MenuContext = {
        isLoaded: Boolean(activeState?.activeCovdbPath),
        isCoverageEnabled: statusBar.isCoverageEnabled(),
        activeCovdbPath: activeState?.activeCovdbPath,
        fileIndex: activeState?.fileIndex ?? new Map(),
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
        createConfig: () => createConfigCommand(context),
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
    const activeState = getActiveCoverageState();
    if (activeState?.workspaceFolder) {
        clearCoverageState(activeState.workspaceFolder, true);
        output.log(
            `Coverage database closed for workspace ${activeState.workspaceFolder.name}`,
        );
    } else {
        for (const state of coverageStates.values()) {
            clearCoverageState(state.workspaceFolder, false);
        }
        vscode.window.visibleTextEditors.forEach((e) =>
            decorator.clearDecorations(e),
        );
        output.log("Coverage database closed");
    }
    updateActiveWorkspaceUi();
    void flushPendingCovdbReloads();
}

async function showFileBrowser(): Promise<void> {
    const activeState = getActiveCoverageState();
    await showFileBrowserPopup(activeState?.fileIndex ?? new Map());
}

async function applyRenderMode(
    mode: RenderMode,
    context: vscode.ExtensionContext,
): Promise<void> {
    decorator.setRenderMode(mode);
    statusBar.setRenderMode(mode);
    context.workspaceState.update("covdbg.renderMode", mode);
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

async function createConfigCommand(
    context: vscode.ExtensionContext,
): Promise<void> {
    const targetFolder = await pickWorkspaceFolderForConfig();
    if (!targetFolder) {
        return;
    }

    await createConfigInWorkspace(context, targetFolder);
}

async function createConfigInWorkspace(
    context: vscode.ExtensionContext,
    targetFolder: vscode.WorkspaceFolder,
): Promise<void> {

    const configPath = path.join(targetFolder.uri.fsPath, CONFIG_FILE_NAME);
    if (await fileExists(configPath)) {
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        return;
    }

    await fs.writeFile(configPath, buildStarterConfigContents(), "utf8");
    await context.workspaceState.update(CONFIG_PROMPT_ACK_KEY, true);

    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    vscode.window.showInformationMessage(
        `covdbg: Created ${CONFIG_FILE_NAME} in ${targetFolder.name}.`,
    );
    sidebar.scheduleRefresh();
}

async function handleCovdbgConfigFileChange(
    context: vscode.ExtensionContext,
    configUri: vscode.Uri,
    deleted = false,
): Promise<void> {
    if (deleted) {
        await clearDeletedRunnerConfigPath(configUri);
        if (!(await workspaceContainsCovdbgYaml())) {
            await maybeOfferToCreateConfig(context, false);
        }
    }

    sidebar.scheduleRefresh();
}

async function clearDeletedRunnerConfigPath(
    configUri: vscode.Uri,
): Promise<void> {
    const workspaceFolder = getWorkspaceFolderForPath(configUri.fsPath);
    if (!workspaceFolder) {
        return;
    }

    const config = vscode.workspace.getConfiguration(
        "covdbg",
        workspaceFolder.uri,
    );
    const inspected = config.inspect<string>("runner.configPath");
    if (!inspected) {
        return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    let cleared = false;

    if (
        configuredRunnerConfigMatches(
            inspected.workspaceFolderValue,
            workspaceRoot,
            configUri.fsPath,
        )
    ) {
        await config.update(
            "runner.configPath",
            undefined,
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
        cleared = true;
    }

    if (
        configuredRunnerConfigMatches(
            inspected.workspaceValue,
            workspaceRoot,
            configUri.fsPath,
        )
    ) {
        await config.update(
            "runner.configPath",
            undefined,
            vscode.ConfigurationTarget.Workspace,
        );
        cleared = true;
    }

    if (
        configuredRunnerConfigMatches(
            inspected.globalValue,
            workspaceRoot,
            configUri.fsPath,
        )
    ) {
        await config.update(
            "runner.configPath",
            undefined,
            vscode.ConfigurationTarget.Global,
        );
        cleared = true;
    }

    if (cleared) {
        output.log(
            `covdbg: cleared stale runner.configPath after ${CONFIG_FILE_NAME} was deleted: ${configUri.fsPath}`,
        );
    }
}

function configuredRunnerConfigMatches(
    configuredPath: string | undefined,
    workspaceRoot: string,
    targetPath: string,
): boolean {
    if (!configuredPath || configuredPath.trim().length === 0) {
        return false;
    }

    return (
        path.normalize(resolvePathFromWorkspace(configuredPath, workspaceRoot))
            .toLowerCase() === path.normalize(targetPath).toLowerCase()
    );
}

async function runCoverageCommand(
    context: vscode.ExtensionContext,
): Promise<void> {
    await refreshTestControllerItems();
    const selectedItems = await promptForDiscoveredTestItems();
    if (!selectedItems || selectedItems.length === 0) {
        return;
    }

    const cancellation = new vscode.CancellationTokenSource();
    try {
        await runCoverageFromTestRequest(
            new vscode.TestRunRequest(selectedItems),
            cancellation.token,
            context,
        );
    } finally {
        cancellation.dispose();
    }
}

async function handleLicenseStatusUpdate(
    context: vscode.ExtensionContext,
    licenseStatus: LicenseStatusSnapshot | undefined,
    runSucceeded: boolean,
): Promise<void> {
    sidebar.setLicenseStatus(licenseStatus);
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
    const toDelete = [...lastRunOutputPaths];
    closeCovdb();
    statusBar.clearLastRunResult();

    if (toDelete.length > 0) {
        let deletedCount = 0;
        for (const outputPath of toDelete) {
            if (!(await fileExists(outputPath))) {
                continue;
            }

            try {
                await fs.unlink(outputPath);
                deletedCount++;
                output.log(`Cleared last run result: ${outputPath}`);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                output.logError(`Failed to clear last run result: ${message}`);
                vscode.window.showWarningMessage(
                    `covdbg: Failed to delete last .covdb: ${message}`,
                );
                break;
            }
        }

        if (deletedCount > 0) {
            vscode.window.showInformationMessage(
                "covdbg: Last run result cleared.",
            );
        } else {
            output.log("Cleared UI state for last run result.");
            vscode.window.showInformationMessage(
                "covdbg: Cleared last run state.",
            );
        }
    } else {
        output.log("Cleared UI state for last run result.");
        vscode.window.showInformationMessage("covdbg: Cleared last run state.");
    }
    lastRunOutputPaths = [];
    sidebar.scheduleRefresh();
}

async function showCoverageReportCommand(): Promise<void> {
    const activeState = getActiveCoverageState();
    await report.show(
        activeState?.fileIndex ?? new Map(),
        activeState?.activeCovdbPath,
        extensionUri,
    );
}

async function getUncoveredCode(
    filePath?: string,
): Promise<UncoveredCodeResult> {
    const resolvedPath = resolveRequestedFilePath(filePath);
    if (!resolvedPath) {
        output.logError(
            "getUncoveredCode: no file path provided and no active editor available",
        );
        return emptyUncoveredCodeResult(filePath ?? "");
    }

    const document = await openDocumentIfExists(resolvedPath);
    if (!document) {
        output.logError(`getUncoveredCode: file not found: ${resolvedPath}`);
        return emptyUncoveredCodeResult(resolvedPath);
    }

    if (!getActiveCoverageState()?.activeCovdbPath) {
        return emptyUncoveredCodeResult(
            resolvedPath,
            buildNoCoverageLoadedGuidance(),
        );
    }

    const state = getCoverageStateForPath(resolvedPath);
    const cacheKey = getUncoveredCodeCacheKey(resolvedPath);
    const cached = uncoveredCodeCache.get(cacheKey);
    if (
        cached &&
        cached.covdbPath === state?.activeCovdbPath &&
        cached.covdbMtime === (state?.activeCovdbMtime ?? 0) &&
        cached.documentVersion === document.version
    ) {
        return cached.result;
    }

    const coverage = await getOrLoadCoverage(resolvedPath);
    const result = buildUncoveredCodeResult(
        resolvedPath,
        document.getText(),
        coverage,
        {
            workspaceRelativePath: vscode.workspace.asRelativePath(
                resolvedPath,
                false,
            ),
        },
    );

    uncoveredCodeCache.set(cacheKey, {
        covdbPath: state?.activeCovdbPath,
        covdbMtime: state?.activeCovdbMtime ?? 0,
        documentVersion: document.version,
        result,
    });

    return result;
}

async function exploreUncoveredFiles(
    input: ExploreUncoveredFilesInput,
): Promise<ExploreUncoveredFilesResult> {
    const activeState = getActiveCoverageState();
    if (!activeState?.activeCovdbPath || activeState.fileIndex.size === 0) {
        return {
            activeCovdbPath: activeState?.activeCovdbPath,
            coverageSummary: emptyCoverageSummary(
                activeState?.fileIndex.size ?? 0,
            ),
            totalIndexedFiles: activeState?.fileIndex.size ?? 0,
            returnedFileCount: 0,
            files: [],
            llmGuidance: buildNoActiveCoverageExploreGuidance(),
            message: "No active coverage database is loaded.",
        };
    }

    return buildExploreUncoveredFilesResult(activeState.fileIndex, {
        ...input,
        activeCovdbPath: activeState.activeCovdbPath,
        workspaceRelativePathForFile: (candidatePath) =>
            vscode.workspace.asRelativePath(candidatePath, false),
    });
}

async function runTestWithCoverage(
    context: vscode.ExtensionContext,
    executablePaths: string[],
): Promise<RunTestWithCoverageToolResult> {
    const workflow = await withDeferredCovdbReloads(() =>
        runTestWithCoverageWorkflow(executablePaths, {
            resolveExecutablePath: (inputPath) =>
                resolveWorkspaceRelativePath(inputPath),
            fileExists,
            shouldFinalizeOutputs: () =>
                executablePaths.some((candidatePath) =>
                    shouldFinalizeCoverageOutputs(
                        resolveWorkspaceRelativePath(candidatePath) ?? candidatePath,
                    ),
                ),
            buildBatchIntermediateOutputPath,
            executeCoverageRun: (resolvedExecutablePath, outputPathOverride) =>
                executeCoverageRun(
                    context,
                    resolvedExecutablePath,
                    outputPathOverride,
                ),
            finalizeBatchCoverageOutputs: (
                successfulOutputPaths,
                generatedOutputPaths,
            ) =>
                finalizeBatchCoverageOutputs(
                    context,
                    successfulOutputPaths,
                    generatedOutputPaths,
                ),
            dedupePaths: dedupeNormalizedPaths,
        }),
    );

    lastRunOutputPaths = workflow.lastRunOutputPaths;
    return workflow.toolResult;
}

async function executeCoverageRun(
    context: vscode.ExtensionContext,
    targetExecutablePath: string,
    outputPathOverride?: string,
): Promise<{
    success: boolean;
    outputPath?: string;
    configuredOutputPath?: string;
    coverageLoaded: boolean;
    coverageSummary?: CoverageSummary;
    licenseStatus?: LicenseStatusSnapshot;
}> {
    statusBar.setRunning();
    const result = await runCoverageForTarget(
        context,
        targetExecutablePath,
        outputPathOverride,
        undefined,
        (ok) => (ok ? statusBar.setRunSucceeded() : statusBar.setRunFailed()),
    );

    await handleLicenseStatusUpdate(
        context,
        result.licenseStatus,
        result.success,
    );

    let coverageLoaded = false;
    let coverageSummary: CoverageSummary | undefined;
    if (result.success) {
        if (result.outputPath && (await fileExists(result.outputPath))) {
            await loadIndex(result.outputPath, "settings");
            coverageLoaded = true;
        } else {
            await discoverAndLoadIndex(context);
            coverageLoaded = Boolean(
                getCoverageStateForPath(targetExecutablePath)?.activeCovdbPath ??
                getActiveCoverageState()?.activeCovdbPath,
            );
        }

        coverageSummary = getCoverageSummaryForExecutable(targetExecutablePath);
    }

    return {
        success: result.success,
        outputPath: result.outputPath,
        configuredOutputPath: result.configuredOutputPath,
        coverageLoaded,
        coverageSummary,
        licenseStatus: result.licenseStatus,
    };
}

function getCoverageSummaryForExecutable(
    targetExecutablePath: string,
): CoverageSummary | undefined {
    const state = getCoverageStateForPath(targetExecutablePath)
        ?? getActiveCoverageState();
    if (!state?.activeCovdbPath || state.fileIndex.size === 0) {
        return undefined;
    }

    return buildCoverageSummaryFromFileIndex(state.fileIndex);
}

async function finalizeBatchCoverageOutputs(
    context: vscode.ExtensionContext,
    successfulOutputPaths: string[],
    generatedOutputPaths: string[],
): Promise<{
    success: boolean;
    coverageLoaded: boolean;
    finalizedOutputPath?: string;
    mergePerformed: boolean;
    mergedInputCount: number;
    coverageSummary?: CoverageSummary;
    lastRunOutputPaths: string[];
}> {
    lastRunOutputPaths = dedupeNormalizedPaths(generatedOutputPaths);

    if (successfulOutputPaths.length === 0) {
        return {
            success: false,
            coverageLoaded: false,
            finalizedOutputPath: undefined,
            mergePerformed: false,
            mergedInputCount: 0,
            lastRunOutputPaths,
        };
    }

    const canonicalOutputPath = getCanonicalCoverageOutputPath(
        successfulOutputPaths[0],
    );
    if (!canonicalOutputPath) {
        return {
            success: false,
            coverageLoaded: Boolean(getActiveCoverageState()?.activeCovdbPath),
            finalizedOutputPath: undefined,
            mergePerformed: successfulOutputPaths.length > 1,
            mergedInputCount: successfulOutputPaths.length,
            coverageSummary: getCoverageSummaryForPath(
                successfulOutputPaths[successfulOutputPaths.length - 1],
            ),
            lastRunOutputPaths,
        };
    }

    const analyzeResults = await analyzeCoverageConfiguredInputs(
        context,
        canonicalOutputPath,
    );
    const analyzedOutputPaths = analyzeResults
        .filter((result) => result.success)
        .map((result) => result.outputPath);
    const finalInputPaths = dedupeNormalizedPaths([
        ...successfulOutputPaths,
        ...analyzedOutputPaths,
    ]);
    const analysisSucceeded = analyzeResults.every((result) => result.success);
    lastRunOutputPaths = dedupeNormalizedPaths([
        ...generatedOutputPaths,
        ...analyzedOutputPaths,
    ]);

    const finalized =
        finalInputPaths.length === 1
            ? await copyCoverageFile(finalInputPaths[0], canonicalOutputPath)
            : await mergeCoverageFiles(
                context,
                finalInputPaths,
                canonicalOutputPath,
                getWorkspaceFolderForPath(canonicalOutputPath),
            );

    if (!finalized || !(await fileExists(canonicalOutputPath))) {
        statusBar.setRunFailed();
        return {
            success: false,
            coverageLoaded: Boolean(getActiveCoverageState()?.activeCovdbPath),
            finalizedOutputPath: canonicalOutputPath,
            mergePerformed: finalInputPaths.length > 1,
            mergedInputCount: finalInputPaths.length,
            coverageSummary: getCoverageSummaryForPath(
                successfulOutputPaths[successfulOutputPaths.length - 1],
            ),
            lastRunOutputPaths,
        };
    }

    lastRunOutputPaths = dedupeNormalizedPaths([
        ...generatedOutputPaths,
        ...analyzedOutputPaths,
        canonicalOutputPath,
    ]);
    await loadIndex(canonicalOutputPath, "settings");
    if (analysisSucceeded) {
        statusBar.setRunSucceeded();
    } else {
        statusBar.setRunFailed();
    }

    return {
        success: analysisSucceeded,
        coverageLoaded: true,
        finalizedOutputPath: canonicalOutputPath,
        mergePerformed: finalInputPaths.length > 1,
        mergedInputCount: finalInputPaths.length,
        coverageSummary: getCoverageSummaryForPath(canonicalOutputPath),
        lastRunOutputPaths,
    };
}

async function analyzeCoverageConfiguredInputs(
    context: vscode.ExtensionContext,
    canonicalOutputPath: string,
): Promise<Array<{ inputPath: string; outputPath: string; success: boolean }>> {
    const workspaceFolder = getWorkspaceFolderForPath(canonicalOutputPath);
    const analyzeInputs = getConfiguredAnalyzeInputPaths(canonicalOutputPath);
    if (analyzeInputs.length === 0) {
        return [];
    }

    return analyzeCoverageBinaries(
        context,
        analyzeInputs,
        canonicalOutputPath,
        workspaceFolder,
    );
}

function buildBatchIntermediateOutputPath(
    targetExecutablePath: string,
): string | undefined {
    const workspaceFolder = getPreferredWorkspaceFolder(targetExecutablePath);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        return undefined;
    }

    const settings = readRunnerSettings(workspaceFolder?.uri);
    const paths = resolveRunnerPaths(settings, workspaceRoot);
    return deriveCoverageBatchOutputPath(
        paths.configuredOutputPath,
        targetExecutablePath,
    );
}

function getCanonicalCoverageOutputPath(
    targetPathForWorkspace: string,
): string | undefined {
    const workspaceFolder = getPreferredWorkspaceFolder(targetPathForWorkspace);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        return undefined;
    }

    const settings = readRunnerSettings(workspaceFolder?.uri);
    return resolveRunnerPaths(settings, workspaceRoot).configuredOutputPath;
}

function shouldFinalizeCoverageOutputs(
    targetPathForWorkspace: string,
): boolean {
    return getConfiguredAnalyzeInputPaths(targetPathForWorkspace).length > 0;
}

function getConfiguredAnalyzeInputPaths(
    targetPathForWorkspace: string,
): string[] {
    const workspaceFolder = getPreferredWorkspaceFolder(targetPathForWorkspace);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        return [];
    }

    const settings = readRunnerSettings(workspaceFolder?.uri);
    return resolveAnalyzeInputsForTarget(
        settings,
        workspaceRoot,
        targetPathForWorkspace,
    );
}

async function copyCoverageFile(
    sourcePath: string,
    targetPath: string,
): Promise<boolean> {
    try {
        if (
            path.normalize(sourcePath).toLowerCase() ===
            path.normalize(targetPath).toLowerCase()
        ) {
            return true;
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
        output.log(`Copied coverage output to ${targetPath}`);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.logError(`Failed to copy coverage output: ${message}`);
        return false;
    }
}

function getCoverageSummaryForPath(filePath: string): CoverageSummary | undefined {
    const state = getCoverageStateForPath(filePath) ?? getActiveCoverageState();
    if (!state?.activeCovdbPath || state.fileIndex.size === 0) {
        return undefined;
    }

    return buildCoverageSummaryFromFileIndex(state.fileIndex);
}

async function openDocumentIfExists(
    filePath: string,
): Promise<vscode.TextDocument | undefined> {
    try {
        return await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    } catch {
        return undefined;
    }
}

function resolveRequestedFilePath(filePath?: string): string | undefined {
    const candidate =
        filePath?.trim() || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!candidate) {
        return undefined;
    }

    if (path.isAbsolute(candidate)) {
        return path.normalize(candidate);
    }

    const editorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const workspaceFolder = editorPath
        ? getWorkspaceFolderForPath(editorPath)
        : getPreferredWorkspaceFolder();
    const basePath =
        workspaceFolder?.uri.fsPath
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    return basePath
        ? path.normalize(path.resolve(basePath, candidate))
        : path.normalize(path.resolve(candidate));
}

function resolveWorkspaceRelativePath(inputPath?: string): string | undefined {
    const candidate = inputPath?.trim();
    if (!candidate) {
        return undefined;
    }

    if (path.isAbsolute(candidate)) {
        return path.normalize(candidate);
    }

    const editorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const workspaceFolder = editorPath
        ? getWorkspaceFolderForPath(editorPath)
        : getPreferredWorkspaceFolder();
    const basePath =
        workspaceFolder?.uri.fsPath
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    return basePath
        ? path.normalize(path.resolve(basePath, candidate))
        : path.normalize(path.resolve(candidate));
}

function getUncoveredCodeCacheKey(filePath: string): string {
    return path.normalize(filePath).toLowerCase();
}

function resolveWorkspacePathForFolder(
    inputPath: string,
    workspaceFolder: vscode.WorkspaceFolder,
): string {
    if (path.isAbsolute(inputPath)) {
        return inputPath;
    }
    return path.resolve(workspaceFolder.uri.fsPath, inputPath);
}

async function getExplicitCovdbCandidates(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const candidates: string[] = [];

    if (!workspaceFolders || workspaceFolders.length === 0) {
        const explicit = vscode.workspace
            .getConfiguration("covdbg")
            .get<string>("covdbPath", "")
            .trim();
        if (explicit) {
            if (await fileExists(explicit)) {
                candidates.push(explicit);
            } else {
                output.logError(`covdbg.covdbPath not found: ${explicit}`);
            }
        }
        return candidates;
    }

    for (const folder of workspaceFolders) {
        const explicit = vscode.workspace
            .getConfiguration("covdbg", folder.uri)
            .get<string>("covdbPath", "")
            .trim();
        if (!explicit) {
            continue;
        }

        const resolved = resolveWorkspacePathForFolder(explicit, folder);
        if (await fileExists(resolved)) {
            candidates.push(resolved);
        } else {
            output.logError(
                `covdbg.covdbPath not found for workspace folder ${folder.name}: ${resolved}`,
            );
        }
    }

    return dedupePaths(candidates);
}

async function getExplicitCovdbCandidateForFolder(
    workspaceFolder: vscode.WorkspaceFolder,
): Promise<string | undefined> {
    const explicit = vscode.workspace
        .getConfiguration("covdbg", workspaceFolder.uri)
        .get<string>("covdbPath", "")
        .trim();
    if (!explicit) {
        return undefined;
    }

    const resolved = resolveWorkspacePathForFolder(explicit, workspaceFolder);
    if (await fileExists(resolved)) {
        return resolved;
    }

    output.logError(
        `covdbg.covdbPath not found for workspace folder ${workspaceFolder.name}: ${resolved}`,
    );
    return undefined;
}

async function findDiscoveredCovdbFiles(
    workspaceFolder?: vscode.WorkspaceFolder,
): Promise<vscode.Uri[]> {
    if (workspaceFolder) {
        const pattern = vscode.workspace
            .getConfiguration("covdbg", workspaceFolder.uri)
            .get<string>("discoveryPattern", "**/*.covdb");
        return vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, pattern),
            DISCOVERY_EXCLUDE_GLOB,
            MAX_DISCOVERED_COVDB_FILES,
        );
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const found: vscode.Uri[] = [];

    if (!workspaceFolders || workspaceFolders.length === 0) {
        const pattern = vscode.workspace
            .getConfiguration("covdbg")
            .get<string>("discoveryPattern", "**/*.covdb");
        return vscode.workspace.findFiles(
            pattern,
            DISCOVERY_EXCLUDE_GLOB,
            MAX_DISCOVERED_COVDB_FILES,
        );
    }

    for (const folder of workspaceFolders) {
        const pattern = vscode.workspace
            .getConfiguration("covdbg", folder.uri)
            .get<string>("discoveryPattern", "**/*.covdb");
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, pattern),
            DISCOVERY_EXCLUDE_GLOB,
            MAX_DISCOVERED_COVDB_FILES,
        );
        found.push(...matches);
    }

    return dedupeUris(found);
}

async function findCovdbgConfigFiles(
    workspaceFolder?: vscode.WorkspaceFolder,
    maxResults = MAX_DISCOVERED_COVDB_FILES,
): Promise<vscode.Uri[]> {
    if (workspaceFolder) {
        return vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, CONFIG_FILE_GLOB),
            DISCOVERY_EXCLUDE_GLOB,
            maxResults,
        );
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return vscode.workspace.findFiles(
            CONFIG_FILE_GLOB,
            DISCOVERY_EXCLUDE_GLOB,
            maxResults,
        );
    }

    const found: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, CONFIG_FILE_GLOB),
            DISCOVERY_EXCLUDE_GLOB,
            maxResults,
        );
        found.push(...matches);
    }

    return dedupeUris(found);
}

async function workspaceContainsCovdbgYaml(): Promise<boolean> {
    return (await findCovdbgConfigFiles(undefined, 1)).length > 0;
}

async function maybeOfferToCreateConfig(
    context: vscode.ExtensionContext,
    forcePrompt: boolean,
): Promise<void> {
    if (setupPromptInFlight) {
        return;
    }
    if (!vscode.workspace.isTrusted) {
        return;
    }
    if (!vscode.workspace.workspaceFolders?.length) {
        return;
    }
    if (await workspaceContainsCovdbgYaml()) {
        return;
    }
    if (
        !forcePrompt &&
        context.workspaceState.get<boolean>(CONFIG_PROMPT_ACK_KEY)
    ) {
        return;
    }

    setupPromptInFlight = true;
    try {
        const createAction = `Create ${CONFIG_FILE_NAME}`;
        const picked = await vscode.window.showInformationMessage(
            "covdbg: No .covdbg.yaml found in this workspace. Create one now?",
            createAction,
            "Not now",
        );
        await context.workspaceState.update(CONFIG_PROMPT_ACK_KEY, true);
        if (picked === createAction) {
            await createConfigCommand(context);
        }
    } finally {
        setupPromptInFlight = false;
    }
}

async function pickWorkspaceFolderForConfig(): Promise<vscode.WorkspaceFolder | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage(
            "covdbg: Open a workspace folder before creating .covdbg.yaml.",
        );
        return undefined;
    }

    if (workspaceFolders.length === 1) {
        return workspaceFolders[0];
    }

    const picked = await vscode.window.showQuickPick(
        workspaceFolders.map((folder) => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder,
        })),
        {
            title: "covdbg: Choose workspace folder for .covdbg.yaml",
            placeHolder: "Select the workspace folder where the starter config should be created",
            matchOnDescription: true,
        },
    );
    return picked?.folder;
}

function buildStarterConfigContents(): string {
    return [
        "# Coverage settings for covdbg",
        "# Format version: 1",
        "",
        "version: 1",
        "source_root: \".\"",
        "coverage:",
        "  default:",
        "    files:",
        "      # Select which source files are included in the coverage report.",
        "      #",
        "      # The patterns are glob-style:",
        "      #   - '*'  matches any characters within a single path segment (no directory separators)",
        "      #   - '**' matches across directory boundaries (recursive)",
        "      #",
        "      # Files matched by 'include' are added to the coverage database even if they are",
        "      # not discovered via linked debug info (PDB). If they are never executed, they",
        "      # will appear as 0% coverage (LCOV-like behavior).",
        "      include:",
        "        - \"**/*.cpp\"",
        "        - \"**/*.h\"",
        "",
        "      # Exclude specific files or directories from the report.",
        "      # Exclude rules always take precedence over include rules.",
        "      exclude:",
        "        # =====================================================================",
        "        # Windows SDK and Universal CRT (installed paths)",
        "        # \"C:/Program Files*/Windows Kits/**\"",
        "        # =====================================================================",
        "        - \"**/Windows Kits/**\"",
        "",
        "        # =====================================================================",
        "        # MSVC Toolchain (installed paths)",
        "        # \"C:/Program Files*/Microsoft Visual Studio/**/VC/Tools/**\"",
        "        # =====================================================================",
        "        - \"**/VC/Tools/MSVC/**\"",
        "",
        "        # =====================================================================",
        "        # MSVC CRT/STL Source (build server paths from PDBs)",
        "        # These patterns match paths embedded in Microsoft's pre-built binaries",
        "        # from their internal build systems (D:\\a\\_work\\1\\s\\src\\...)",
        "        # =====================================================================",
        "        - \"**/vctools/crt/**\"           # CRT runtime, startup, vcruntime",
        "        - \"**/vctools/langapi/**\"       # Language API (undname, etc.)",
        "        - \"**/stl/inc/**\"               # STL headers",
        "        - \"**/stl/src/**\"               # STL source",
        "",
        "        # =====================================================================",
        "        # Universal CRT (UCRT) - minkernel paths from Windows PDBs",
        "        # =====================================================================",
        "        - \"**/minkernel/crts/ucrt/**\"   # UCRT implementation",
        "        - \"**/minkernel/crts/crtw32/**\" # Legacy CRT components",
        "",
        "        # =====================================================================",
        "        # Windows SDK internals (onecore paths from Windows PDBs)",
        "        # =====================================================================",
        "        - \"**/onecore/**\"               # OneCore SDK internals",
        "",
        "        # =====================================================================",
        "        # External SDK includes embedded in PDBs",
        "        # =====================================================================",
        "        - \"**/ExternalAPIs/**\"          # External API headers",
        "        - \"**/binaries/amd64ret/inc/**\" # Binary distribution includes",
        "",
        "        # =====================================================================",
        "        # Project-specific exclusions",
        "        # =====================================================================",
        "        # Build dependencies (CMake FetchContent, etc.)",
        "        - \"build/**/_deps/**\"",
        "        - \"third_party/**\"",
        "        - \"external/**\"",
        "        - \"vendor/**\"",
        "",
        "        # Test files or test support code you do not want counted in product coverage",
        "        - \"src/**/*Tests.cpp\"",
        "        - \"tests/helpers/**\"",
        "",
        "    functions:",
        "      # Control which functions are included in function-level coverage.",
        "      #",
        "      # Patterns can be fully qualified names (e.g. Namespace::Class::Method) or",
        "      # wildcard expressions using '*'.",
        "      include:",
        "        - \"*\"  # Include all functions by default",
        "",
        "      # Exclude specific functions (or patterns) from function-level coverage.",
        "      # These are compiler-generated or runtime functions that add noise.",
        "      exclude:",
        "        # MSVC empty global delete (generated by compiler)",
        "        - \"__empty_global_delete\"",
        "",
        "        # CRT startup/initialization functions",
        "        - \"__scrt_*\"",
        "        - \"_RTC_*\"",
        "        - \"__security_*\"",
        "        - \"__GSHandler*\"",
        "",
        "",
    ].join("\n");
}

function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const filePath of paths) {
        const key = path.normalize(filePath).toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(filePath);
    }
    return deduped;
}

function dedupeUris(uris: vscode.Uri[]): vscode.Uri[] {
    const seen = new Set<string>();
    const deduped: vscode.Uri[] = [];
    for (const uri of uris) {
        const key = path.normalize(uri.fsPath).toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(uri);
    }
    return deduped;
}

function getWorkspaceStateKey(
    workspaceFolder?: vscode.WorkspaceFolder,
): string {
    return workspaceFolder?.uri.toString() ?? "__no_workspace__";
}

function getOrCreateCoverageState(
    workspaceFolder?: vscode.WorkspaceFolder,
): CoverageWorkspaceState {
    const key = getWorkspaceStateKey(workspaceFolder);
    let state = coverageStates.get(key);
    if (!state) {
        state = {
            workspaceFolder,
            activeCovdbMtime: 0,
            fileIndex: new Map(),
            coverageCache: new Map(),
            staleCoverageKeys: new Set(),
        };
        coverageStates.set(key, state);
    } else if (workspaceFolder) {
        state.workspaceFolder = workspaceFolder;
    }
    return state;
}

function getWorkspaceFolderForPath(
    filePath: string,
): vscode.WorkspaceFolder | undefined {
    const exactFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(filePath),
    );
    return exactFolder ?? getPreferredWorkspaceFolder(filePath);
}

function getCoverageStateForPath(
    filePath: string,
): CoverageWorkspaceState | undefined {
    const workspaceFolder = getWorkspaceFolderForPath(filePath);
    return coverageStates.get(getWorkspaceStateKey(workspaceFolder));
}

function getActiveCoverageState(): CoverageWorkspaceState | undefined {
    const activeEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (activeEditorPath) {
        const activeState = getCoverageStateForPath(activeEditorPath);
        if (activeState?.activeCovdbPath) {
            return activeState;
        }
    }

    for (const state of coverageStates.values()) {
        if (state.activeCovdbPath) {
            return state;
        }
    }

    return undefined;
}

function getWorkspaceCoverageState(
    workspaceFolder?: vscode.WorkspaceFolder,
): SidebarCoverageState | undefined {
    return coverageStates.get(getWorkspaceStateKey(workspaceFolder));
}

function updateActiveWorkspaceUi(): void {
    const activeState = getActiveCoverageState();
    if (!activeState?.activeCovdbPath || activeState.fileIndex.size === 0) {
        report.clearFunctionIndex();
        statusBar.setIdle();
        sidebar.scheduleRefresh();
        return;
    }

    statusBar.setLoaded();
    report.update(activeState.fileIndex, activeState.activeCovdbPath);
    sidebar.scheduleRefresh();
}

function clearCoverageState(
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    clearEditors: boolean,
): void {
    const stateKey = getWorkspaceStateKey(workspaceFolder);
    const state = coverageStates.get(stateKey);
    if (!state) {
        return;
    }

    state.activeCovdbPath = undefined;
    state.activeCovdbMtime = 0;
    disposeCovdbWatcher(stateKey);
    state.fileIndex = new Map();
    state.coverageCache.clear();
    state.staleCoverageKeys.clear();
    uncoveredCodeCache.clear();

    if (clearEditors) {
        for (const editor of vscode.window.visibleTextEditors) {
            const editorFolder = getWorkspaceFolderForPath(
                editor.document.uri.fsPath,
            );
            if (getWorkspaceStateKey(editorFolder) === stateKey) {
                decorator.clearDecorations(editor);
            }
        }
    }
}

function pruneCoverageStates(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
): void {
    const validKeys = new Set(
        workspaceFolders.map((folder) => getWorkspaceStateKey(folder)),
    );
    for (const [stateKey] of coverageStates) {
        if (stateKey === "__no_workspace__") {
            continue;
        }
        if (!validKeys.has(stateKey)) {
            disposeCovdbWatcher(stateKey);
            coverageStates.delete(stateKey);
        }
    }
}

async function getMostRecentFile(
    files: vscode.Uri[],
): Promise<vscode.Uri | undefined> {
    let newest: vscode.Uri | undefined;
    let best = 0;
    for (const file of files) {
        const mt = await getMtime(file.fsPath);
        if (mt > best) {
            best = mt;
            newest = file;
        }
    }
    return newest;
}

async function getMostRecentPath(
    paths: string[],
): Promise<string | undefined> {
    let newest: string | undefined;
    let best = 0;
    for (const candidatePath of paths) {
        const mt = await getMtime(candidatePath);
        if (mt > best) {
            best = mt;
            newest = candidatePath;
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
        "covdbg",
    );
    context.subscriptions.push(testingController);

    testingRootItem = testingController.createTestItem("covdbg.root", "covdbg");
    testingRootItem.description = "Discovering test executables...";
    testingRootItem.canResolveChildren = true;
    testingController.items.replace([testingRootItem]);
    testingController.resolveHandler = async (item) => {
        if (!item || item.id === testingRootItem?.id) {
            await refreshTestControllerItems();
        }
    };
    testingController.refreshHandler = async () => {
        await refreshTestControllerItems();
    };

    testingController.createRunProfile(
        "Run with Coverage",
        vscode.TestRunProfileKind.Run,
        (request, token) => runCoverageFromTestRequest(request, token, context),
        true,
    );

    void refreshTestControllerItems();
}

async function refreshTestControllerItems(): Promise<void> {
    if (!testingController || !testingRootItem) {
        return;
    }
    testingController.items.replace([testingRootItem]);
    testExecutablePaths.clear();
    testingRootItem.children.replace([]);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        testingRootItem.description = "Open a workspace folder to discover tests";
        sidebar.setDiscoveredTestCount(0);
        lastDiscoveredTestBinaryIds = undefined;
        return;
    }

    const binaries = await listDiscoveredExecutablePaths();
    const items: vscode.TestItem[] = [];
    for (const binaryPath of binaries) {
        const id = path.normalize(binaryPath);
        const item = testingController.createTestItem(
            id,
            path.basename(binaryPath),
        );
        item.description = vscode.workspace.asRelativePath(binaryPath);
        item.canResolveChildren = false;
        items.push(item);
        testExecutablePaths.set(id, binaryPath);
    }

    testingRootItem.description =
        binaries.length === 0
            ? "No discovered tests"
            : `${binaries.length} discovered test${binaries.length === 1 ? "" : "s"}`;
    testingRootItem.children.replace(items);
    sidebar.setDiscoveredTestCount(binaries.length);
    const discoveredBinaryIds = items.map((item) => item.id).join("|");
    if (discoveredBinaryIds !== lastDiscoveredTestBinaryIds) {
        lastDiscoveredTestBinaryIds = discoveredBinaryIds;
        output.log(`Testing API: discovered ${binaries.length} binaries.`);
    }
}

async function runCoverageFromTestRequest(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    context: vscode.ExtensionContext,
): Promise<void> {
    await withDeferredCovdbReloads(async () => {
        if (!testingController) {
            return;
        }
        const run = testingController.createTestRun(request);
        const targets = collectRequestedTests(request, testingController);
        if (targets.length === 0) {
            run.end();
            return;
        }

        const successfulOutputPaths: string[] = [];
        const generatedOutputPaths: string[] = [];
        const batchMode = targets.length > 1;
        let requiresFinalization = batchMode;

        try {
            for (const item of targets) {
                if (token.isCancellationRequested) {
                    run.skipped(item);
                    continue;
                }
                run.started(item);
                statusBar.setRunning();
                const targetExecutablePath = getExecutablePathForTestItem(item);
                if (!targetExecutablePath) {
                    run.errored(
                        item,
                        new vscode.TestMessage("covdbg test item is missing an executable path."),
                    );
                    statusBar.setRunFailed();
                    continue;
                }
                const needsTargetFinalization = shouldFinalizeCoverageOutputs(
                    targetExecutablePath,
                );
                const execution = await executeCoverageRun(
                    context,
                    targetExecutablePath,
                    batchMode || needsTargetFinalization
                        ? buildBatchIntermediateOutputPath(targetExecutablePath)
                        : undefined,
                );
                requiresFinalization =
                    requiresFinalization || needsTargetFinalization;
                if (execution.outputPath) {
                    generatedOutputPaths.push(execution.outputPath);
                }
                if (execution.success) {
                    if (execution.outputPath) {
                        successfulOutputPaths.push(execution.outputPath);
                    }
                    run.passed(item);
                } else {
                    run.failed(item, new vscode.TestMessage("Coverage run failed"));
                }
            }

            if (requiresFinalization) {
                await finalizeBatchCoverageOutputs(
                    context,
                    successfulOutputPaths,
                    generatedOutputPaths,
                );
            } else {
                lastRunOutputPaths = dedupeNormalizedPaths(generatedOutputPaths);
            }
        } finally {
            run.end();
        }
    });
}

function collectRequestedTests(
    request: vscode.TestRunRequest,
    controller: vscode.TestController,
): vscode.TestItem[] {
    const included =
        request.include && request.include.length > 0
            ? [...request.include]
            : collectTopLevelTestItems(controller);
    const excludedIds = new Set((request.exclude ?? []).map((item) => item.id));
    const collected = new Map<string, vscode.TestItem>();

    for (const item of included) {
        collectLeafTestItems(item, excludedIds, collected);
    }

    return [...collected.values()];
}

function collectTopLevelTestItems(
    controller: vscode.TestController,
): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    controller.items.forEach((item) => items.push(item));
    return items;
}

function collectLeafTestItems(
    item: vscode.TestItem,
    excludedIds: Set<string>,
    collected: Map<string, vscode.TestItem>,
): void {
    if (excludedIds.has(item.id)) {
        return;
    }

    if (testExecutablePaths.has(item.id)) {
        collected.set(item.id, item);
        return;
    }

    item.children.forEach((child) =>
        collectLeafTestItems(child, excludedIds, collected),
    );
}

async function promptForDiscoveredTestItems(): Promise<vscode.TestItem[] | undefined> {
    const items = getDiscoveredExecutableTestItems();
    if (items.length === 0) {
        vscode.window.showErrorMessage(
            "covdbg: No discovered test executables found. Adjust covdbg.runner.binaryDiscoveryPattern or covdbg.runner.binaryDiscoveryExcludePattern and refresh test binaries.",
        );
        return undefined;
    }

    const picks = await vscode.window.showQuickPick(
        items.map((item) => ({
            label: item.label,
            description: item.description,
            detail: getExecutablePathForTestItem(item),
            item,
        })),
        {
            title: "covdbg: Select discovered tests",
            placeHolder: "Choose the discovered test executables to run under coverage",
            canPickMany: true,
            matchOnDescription: true,
            matchOnDetail: true,
        },
    );
    return picks?.map((pick) => pick.item);
}

function getDiscoveredExecutableTestItems(): vscode.TestItem[] {
    if (!testingRootItem) {
        return [];
    }

    const items: vscode.TestItem[] = [];
    testingRootItem.children.forEach((item) => items.push(item));
    return items;
}

function getExecutablePathForTestItem(
    item: vscode.TestItem,
): string | undefined {
    return testExecutablePaths.get(item.id);
}

/**
 * Filter a file index to only include files reachable from a workspace folder.
 * Removes SDK headers, system includes, and other external paths.
 */
function filterToWorkspaceFiles(
    files: Map<string, CovdbFileSummary>,
    workspaceFolder?: vscode.WorkspaceFolder,
): Map<string, CovdbFileSummary> {
    const roots = workspaceFolder
        ? [path.normalize(workspaceFolder.uri.fsPath).toLowerCase()]
        : vscode.workspace.workspaceFolders?.map((f) =>
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
