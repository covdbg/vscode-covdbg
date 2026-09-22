import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { CoverageDecorator } from "./coverage/coverageDecorator";
import { RenderMode } from "./types";
import { CovdbParser, CovdbFileSummary, type FileCoverage } from "./coverage/covdbParser";
import { CoverageWorkspaceSession } from "./coverage/coverageSession";
import {
    buildCoverageSummaryFromFileIndex,
    type CoverageSummary,
} from "./coverage/coverageSummary";
import { CovdbReloadScheduler } from "./coverage/covdbReloadScheduler";
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
import { CovdbgSidebarController, SidebarCoverageState } from "./views/sidebar";
import { mergeCoverageFiles, runCoverageForTarget } from "./runner/runnerService";
import {
    listDiscoveredExecutablePaths,
    resolveEffectiveConfigPath,
} from "./runner/workspaceDefaults";
import { resolveCovdbgExecutable } from "./runner/executableResolver";
import { getCovdbgVersion } from "./runner/runtimeInfo";
import {
    COVDBG_MCP_PROVIDER_ID,
    CovdbgMcpServerDefinitionProvider,
} from "./mcp/serverDefinitionProvider";
import {
    getPreferredWorkspaceFolder,
    resolvePathFromWorkspace,
    readRunnerSettings,
    resolveRunnerPaths,
    getWorkspaceRoot,
} from "./runner/settings";
import { dedupeNormalizedPaths, deriveCoverageBatchOutputPath } from "./runner/outputPaths";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let decorator: CoverageDecorator;
let statusBar: StatusBar;
let report: CoverageReport;
let sidebar: CovdbgSidebarController;
/** The extension's install URI, used to resolve bundled assets. */
let extensionUri: vscode.Uri;

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
const covdbWatchers = new Map<string, { covdbPath: string; watcher: vscode.FileSystemWatcher }>();
/**
 * Watchers over the discovery glob, one per workspace folder.
 *
 * Separate from covdbWatchers, which watch the one already-active path and so do not exist at all
 * until something has been loaded. Without these, a .covdb created for the first time - by an MCP
 * run, or by covdbg on the command line - goes unnoticed until the window is reloaded, because
 * discoverAndLoadIndex runs only at activation, on three configuration changes, and on a
 * workspace-folder change.
 */
const covdbDiscoveryWatchers = new Map<string, vscode.FileSystemWatcher>();
/** Debounce timer for a discovery hit, so one run's write does not queue several loads. */
let discoveryReloadTimer: NodeJS.Timeout | undefined;
/** Debounce timer for a watched .covdb being rewritten underneath us. */
let covdbReloadDebounceTimer: NodeJS.Timeout | undefined;
let lastDiscoveredTestBinaryIds: string | undefined;
/** Track last run output for clear command. */
let lastRunOutputPaths: string[] = [];

const CONFIG_FILE_NAME = ".covdbg.yaml";
/** How long the writes to a new .covdb must stop before it is read. */
const DISCOVERY_RELOAD_DEBOUNCE_MS = 750;
const CONFIG_FILE_GLOB = `**/${CONFIG_FILE_NAME}`;
const DISCOVERY_EXCLUDE_GLOB = "**/{.git,node_modules,.vscode,assets}/**";
const MAX_DISCOVERED_COVDB_FILES = 50;

class CoverageWorkspaceState implements SidebarCoverageState {
    constructor(
        public workspaceFolder: vscode.WorkspaceFolder | undefined,
        public readonly session: CoverageWorkspaceSession,
    ) {}

    get activeCovdbPath(): string | undefined {
        return this.session.activeCovdbPath;
    }

    get activeCovdbMtime(): number {
        return this.session.activeCovdbMtime;
    }

    get fileIndex(): Map<string, CovdbFileSummary> {
        return this.session.fileIndex;
    }
}

const coverageStates = new Map<string, CoverageWorkspaceState>();

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
    });

    // Restore persisted render mode (workspace state takes priority, then setting)
    const savedMode = context.workspaceState.get<RenderMode>("covdbg.renderMode");
    const configMode = vscode.workspace
        .getConfiguration("covdbg")
        .get<RenderMode>("renderMode", "gutter");
    const initialMode = savedMode ?? configMode;
    decorator.setRenderMode(initialMode);
    statusBar.setRenderMode(initialMode);

    context.subscriptions.push(
        sidebar,
        ...sidebar.getDisposables(),
        vscode.commands.registerCommand("covdbg.showMenu", () => showMenu(context)),
        vscode.commands.registerCommand("covdbg.toggleCoverage", () => toggleVisibility()),
        vscode.commands.registerCommand("covdbg.showReport", showCoverageReportCommand),
        vscode.commands.registerCommand("covdbg.browseFiles", () => showFileBrowser()),
        vscode.commands.registerCommand("covdbg.setRenderMode", (mode: string) =>
            applyRenderMode(mode as RenderMode, context),
        ),
        vscode.commands.registerCommand("covdbg.configurePath", () => pickCovdbFile()),
        vscode.commands.registerCommand("covdbg.createConfig", () => createConfigCommand(context)),
        vscode.commands.registerCommand("covdbg.runCoverage", () => runCoverageCommand(context)),
        vscode.commands.registerCommand("covdbg.clearLastRunResult", () =>
            clearLastRunResultCommand(),
        ),
        vscode.commands.registerCommand("covdbg.refreshTestBinaries", () =>
            refreshTestControllerItems(),
        ),
        vscode.lm.registerMcpServerDefinitionProvider(
            COVDBG_MCP_PROVIDER_ID,
            new CovdbgMcpServerDefinitionProvider(context),
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
                ensureCovdbDiscoveryWatchers(context);
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
                e.affectsConfiguration("covdbg.runner.binaryDiscoveryPattern") ||
                e.affectsConfiguration("covdbg.runner.binaryDiscoveryExcludePattern")
            ) {
                await refreshTestControllerItems();
            }
            if (
                e.affectsConfiguration("covdbg.executablePath") ||
                e.affectsConfiguration("covdbg.portableCachePath")
            ) {
                await sidebar.refreshRuntimeSummary();
            }
            sidebar.scheduleRefresh();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void refreshTestControllerItems();
            ensureCovdbDiscoveryWatchers(context);
            void discoverAndLoadIndex(context);
            sidebar.scheduleRefresh();
        }),
    );

    const configWatcher = vscode.workspace.createFileSystemWatcher(CONFIG_FILE_GLOB);
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
    void sidebar.refreshSignIn();
    void sidebar.refreshRuntimeSummary();
    ensureCovdbDiscoveryWatchers(context);
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

async function discoverAndLoadIndex(context?: vscode.ExtensionContext): Promise<void> {
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

        const targetWorkspaceFolder = workspaceFolder ?? getWorkspaceFolderForPath(covdbPath);
        const state = getOrCreateCoverageState(targetWorkspaceFolder);
        const showExternal = vscode.workspace
            .getConfiguration("covdbg", targetWorkspaceFolder?.uri)
            .get<boolean>("showExternalFiles", false);
        const result = await state.session.loadIndex(covdbPath, {
            mtime,
            filterFileIndex: showExternal
                ? undefined
                : (fileIndex) => filterToWorkspaceFiles(fileIndex, targetWorkspaceFolder),
        });
        if (result.error) {
            vscode.window.showErrorMessage(`covdbg: ${result.error}`);
            return;
        }
        if (result.totalFileCount === 0) {
            vscode.window.showWarningMessage("covdbg: No coverage data in .covdb");
            return;
        }

        ensureCovdbWatcher(state);

        const excluded = result.totalFileCount - result.loadedFileCount;
        const excludedMsg = excluded > 0 ? ` (${excluded} external files hidden)` : "";
        output.log(`Indexed ${result.loadedFileCount} files${excludedMsg} (mtime ${mtime})`);

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

    if (existing && normalizePathKey(existing.covdbPath) === normalizePathKey(covdbPath)) {
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

/**
 * Watch each workspace folder's discovery glob so a .covdb that has never been loaded is noticed.
 *
 * Cheap to keep open, and idempotent: an existing watcher for a folder is left in place.
 */
function ensureCovdbDiscoveryWatchers(context: vscode.ExtensionContext): void {
    const folders = vscode.workspace.workspaceFolders ?? [];

    for (const stateKey of [...covdbDiscoveryWatchers.keys()]) {
        if (!folders.some((folder) => getWorkspaceStateKey(folder) === stateKey)) {
            covdbDiscoveryWatchers.get(stateKey)?.dispose();
            covdbDiscoveryWatchers.delete(stateKey);
        }
    }

    for (const folder of folders) {
        const stateKey = getWorkspaceStateKey(folder);
        if (covdbDiscoveryWatchers.has(stateKey)) {
            continue;
        }

        const pattern = vscode.workspace
            .getConfiguration("covdbg", folder.uri)
            .get<string>("discoveryPattern", "**/*.covdb");
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, pattern),
        );

        const onDiscovered = (uri: vscode.Uri) => {
            queueDiscoveryReload(uri, folder, context);
        };
        watcher.onDidCreate(onDiscovered);
        watcher.onDidChange(onDiscovered);

        covdbDiscoveryWatchers.set(stateKey, watcher);
    }
}

/**
 * React to a .covdb appearing where nothing was loaded before.
 *
 * Debounced, and deliberately so twice over: covdbg writes the file in pieces, so create is
 * followed by a run of change events, and reading a half-written SQLite file yields either a
 * malformed database or an empty index. Waiting for the writes to stop is the cheap guard the
 * mtime comparison in flushPendingCovdbReloads cannot give, since an mtime says when a file was
 * last touched and nothing about whether it is complete.
 *
 * A folder that already has this path active is left to its own watcher, which has the mtime
 * check and the run-in-progress deferral that this path does not.
 */
function queueDiscoveryReload(
    uri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
    context: vscode.ExtensionContext,
): void {
    const state = coverageStates.get(getWorkspaceStateKey(folder));
    if (state?.activeCovdbPath) {
        return;
    }

    if (discoveryReloadTimer) {
        clearTimeout(discoveryReloadTimer);
    }

    discoveryReloadTimer = setTimeout(() => {
        discoveryReloadTimer = undefined;
        if (covdbReloadScheduler.hasActiveExecution() || isLoadingIndex) {
            return;
        }

        output.log(`covdbg noticed a new coverage database: ${uri.fsPath}`);
        void discoverAndLoadIndex(context);
    }, DISCOVERY_RELOAD_DEBOUNCE_MS);
}

function disposeCovdbDiscoveryWatchers(): void {
    if (discoveryReloadTimer) {
        clearTimeout(discoveryReloadTimer);
        discoveryReloadTimer = undefined;
    }

    if (covdbReloadDebounceTimer) {
        clearTimeout(covdbReloadDebounceTimer);
        covdbReloadDebounceTimer = undefined;
    }

    for (const watcher of covdbDiscoveryWatchers.values()) {
        watcher.dispose();
    }
    covdbDiscoveryWatchers.clear();
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
    disposeCovdbDiscoveryWatchers();
}

function queueCovdbReload(stateKey: string, covdbPath: string): void {
    covdbReloadScheduler.queueReload(stateKey, covdbPath);
    if (covdbReloadScheduler.hasActiveExecution()) {
        output.log(`Queued .covdb reload until current coverage workflow completes: ${covdbPath}`);
        return;
    }

    // Debounced rather than flushed straight away. withDeferredCovdbReloads only covers runs this
    // extension started, so a covdbg writing from anywhere else - an MCP run, a terminal - fires
    // the watcher repeatedly while the file is still being written, and reading a half-written
    // SQLite file gives either a malformed database or an empty index. The mtime check in the
    // flush cannot help: an mtime says when a file was last touched, never whether it is
    // finished. Waiting for the writes to stop is the guard that actually holds.
    if (covdbReloadDebounceTimer) {
        clearTimeout(covdbReloadDebounceTimer);
    }

    covdbReloadDebounceTimer = setTimeout(() => {
        covdbReloadDebounceTimer = undefined;
        void flushPendingCovdbReloads();
    }, DISCOVERY_RELOAD_DEBOUNCE_MS);
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
                covdbReloadScheduler.queueReload(pending.stateKey, pending.covdbPath);
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

            output.log(`.covdb changed on disk, reloading index: ${pending.covdbPath}`);
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

async function withDeferredCovdbReloads<T>(operation: () => Promise<T>): Promise<T> {
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

async function getOrLoadCoverage(editorPath: string): Promise<FileCoverage | undefined> {
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

    return state.session.getOrLoadFileCoverage(key);
}

async function isCoverageStaleForPath(
    editorPath: string,
    key: string,
    state: CoverageWorkspaceState,
): Promise<boolean> {
    if (state.session.hasStaleCoverage(key)) {
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

    state.session.clearCoverage(key);
    state.session.markCoverageStale(key);

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
            vscode.commands.executeCommand("workbench.action.openSettings", "covdbg"),
        switchDatabase: (covdbPath) => loadIndex(covdbPath, "settings"),
        closeDatabase: () => closeCovdb(),
        runCoverage: () => runCoverageCommand(context),
        clearLastRunResult: () => clearLastRunResultCommand(),
        openTestsView: () => vscode.commands.executeCommand("workbench.view.testing.focus"),
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
        vscode.window.visibleTextEditors.forEach((e) => decorator.clearDecorations(e));
    }
}

/** Unload the current .covdb and clear all state. */
function closeCovdb(): void {
    const activeState = getActiveCoverageState();
    if (activeState?.workspaceFolder) {
        clearCoverageState(activeState.workspaceFolder, true);
        output.log(`Coverage database closed for workspace ${activeState.workspaceFolder.name}`);
    } else {
        for (const state of coverageStates.values()) {
            clearCoverageState(state.workspaceFolder, false);
        }
        vscode.window.visibleTextEditors.forEach((e) => decorator.clearDecorations(e));
        output.log("Coverage database closed");
    }
    updateActiveWorkspaceUi();
    void flushPendingCovdbReloads();
}

async function showFileBrowser(): Promise<void> {
    const activeState = getActiveCoverageState();
    await showFileBrowserPopup(activeState?.fileIndex ?? new Map());
}

async function applyRenderMode(mode: RenderMode, context: vscode.ExtensionContext): Promise<void> {
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
        await config.update("covdbPath", result[0].fsPath, vscode.ConfigurationTarget.Workspace);
    }
}

async function createConfigCommand(context: vscode.ExtensionContext): Promise<void> {
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
    }

    sidebar.scheduleRefresh();
}

async function clearDeletedRunnerConfigPath(configUri: vscode.Uri): Promise<void> {
    const workspaceFolder = getWorkspaceFolderForPath(configUri.fsPath);
    if (!workspaceFolder) {
        return;
    }

    const config = vscode.workspace.getConfiguration("covdbg", workspaceFolder.uri);
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

    if (configuredRunnerConfigMatches(inspected.workspaceValue, workspaceRoot, configUri.fsPath)) {
        await config.update("runner.configPath", undefined, vscode.ConfigurationTarget.Workspace);
        cleared = true;
    }

    if (configuredRunnerConfigMatches(inspected.globalValue, workspaceRoot, configUri.fsPath)) {
        await config.update("runner.configPath", undefined, vscode.ConfigurationTarget.Global);
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
        path.normalize(resolvePathFromWorkspace(configuredPath, workspaceRoot)).toLowerCase() ===
        path.normalize(targetPath).toLowerCase()
    );
}

async function runCoverageCommand(context: vscode.ExtensionContext): Promise<void> {
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

/** A refused run names its reason; the fix for the usual one is a sign-in. */
function offerFixForRefusal(refusal: string): void {
    const action = /sign/i.test(refusal) ? "Sign In" : "Open app.covdbg.com";
    void vscode.window
        .showWarningMessage(`covdbg: This run is not licensed: ${refusal}`, action)
        .then((chosen) => {
            if (chosen === "Sign In") {
                void vscode.commands.executeCommand("covdbg.signIn");
            } else if (chosen) {
                void vscode.env.openExternal(vscode.Uri.parse("https://app.covdbg.com"));
            }
        });
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
                const message = error instanceof Error ? error.message : String(error);
                output.logError(`Failed to clear last run result: ${message}`);
                vscode.window.showWarningMessage(
                    `covdbg: Failed to delete last .covdb: ${message}`,
                );
                break;
            }
        }

        if (deletedCount > 0) {
            vscode.window.showInformationMessage("covdbg: Last run result cleared.");
        } else {
            output.log("Cleared UI state for last run result.");
            vscode.window.showInformationMessage("covdbg: Cleared last run state.");
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
}> {
    statusBar.setRunning();
    const result = await runCoverageForTarget(
        context,
        targetExecutablePath,
        outputPathOverride,
        undefined,
        (ok) => (ok ? statusBar.setRunSucceeded() : statusBar.setRunFailed()),
    );

    if (result.refusal) {
        offerFixForRefusal(result.refusal);
    }

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
    };
}

function getCoverageSummaryForExecutable(
    targetExecutablePath: string,
): CoverageSummary | undefined {
    const state = getCoverageStateForPath(targetExecutablePath) ?? getActiveCoverageState();
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

    const canonicalOutputPath = getCanonicalCoverageOutputPath(successfulOutputPaths[0]);
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

    const finalInputPaths = dedupeNormalizedPaths(successfulOutputPaths);
    lastRunOutputPaths = dedupeNormalizedPaths(generatedOutputPaths);

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

    lastRunOutputPaths = dedupeNormalizedPaths([...generatedOutputPaths, canonicalOutputPath]);
    await loadIndex(canonicalOutputPath, "settings");
    statusBar.setRunSucceeded();

    return {
        success: true,
        coverageLoaded: true,
        finalizedOutputPath: canonicalOutputPath,
        mergePerformed: finalInputPaths.length > 1,
        mergedInputCount: finalInputPaths.length,
        coverageSummary: getCoverageSummaryForPath(canonicalOutputPath),
        lastRunOutputPaths,
    };
}

function buildBatchIntermediateOutputPath(targetExecutablePath: string): string | undefined {
    const workspaceFolder = getPreferredWorkspaceFolder(targetExecutablePath);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        return undefined;
    }

    const settings = readRunnerSettings(workspaceFolder?.uri);
    const paths = resolveRunnerPaths(settings, workspaceRoot);
    return deriveCoverageBatchOutputPath(paths.configuredOutputPath, targetExecutablePath);
}

function getCanonicalCoverageOutputPath(targetPathForWorkspace: string): string | undefined {
    const workspaceFolder = getPreferredWorkspaceFolder(targetPathForWorkspace);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        return undefined;
    }

    const settings = readRunnerSettings(workspaceFolder?.uri);
    return resolveRunnerPaths(settings, workspaceRoot).configuredOutputPath;
}

async function copyCoverageFile(sourcePath: string, targetPath: string): Promise<boolean> {
    try {
        if (path.normalize(sourcePath).toLowerCase() === path.normalize(targetPath).toLowerCase()) {
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
        return vscode.workspace.findFiles(CONFIG_FILE_GLOB, DISCOVERY_EXCLUDE_GLOB, maxResults);
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
        'source_root: "."',
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
        '        - "**/*.cpp"',
        '        - "**/*.h"',
        "",
        "      # Exclude specific files or directories from the report.",
        "      # Exclude rules always take precedence over include rules.",
        "      exclude:",
        "        # =====================================================================",
        "        # Windows SDK and Universal CRT (installed paths)",
        '        # "C:/Program Files*/Windows Kits/**"',
        "        # =====================================================================",
        '        - "**/Windows Kits/**"',
        "",
        "        # =====================================================================",
        "        # MSVC Toolchain (installed paths)",
        '        # "C:/Program Files*/Microsoft Visual Studio/**/VC/Tools/**"',
        "        # =====================================================================",
        '        - "**/VC/Tools/MSVC/**"',
        "",
        "        # =====================================================================",
        "        # MSVC CRT/STL Source (build server paths from PDBs)",
        "        # These patterns match paths embedded in Microsoft's pre-built binaries",
        "        # from their internal build systems (D:\\a\\_work\\1\\s\\src\\...)",
        "        # =====================================================================",
        '        - "**/vctools/crt/**"           # CRT runtime, startup, vcruntime',
        '        - "**/vctools/langapi/**"       # Language API (undname, etc.)',
        '        - "**/stl/inc/**"               # STL headers',
        '        - "**/stl/src/**"               # STL source',
        "",
        "        # =====================================================================",
        "        # Universal CRT (UCRT) - minkernel paths from Windows PDBs",
        "        # =====================================================================",
        '        - "**/minkernel/crts/ucrt/**"   # UCRT implementation',
        '        - "**/minkernel/crts/crtw32/**" # Legacy CRT components',
        "",
        "        # =====================================================================",
        "        # Windows SDK internals (onecore paths from Windows PDBs)",
        "        # =====================================================================",
        '        - "**/onecore/**"               # OneCore SDK internals',
        "",
        "        # =====================================================================",
        "        # External SDK includes embedded in PDBs",
        "        # =====================================================================",
        '        - "**/ExternalAPIs/**"          # External API headers',
        '        - "**/binaries/amd64ret/inc/**" # Binary distribution includes',
        "",
        "        # =====================================================================",
        "        # Project-specific exclusions",
        "        # =====================================================================",
        "        # Build dependencies (CMake FetchContent, etc.)",
        '        - "build/**/_deps/**"',
        '        - "third_party/**"',
        '        - "external/**"',
        '        - "vendor/**"',
        "",
        "        # Test files or test support code you do not want counted in product coverage",
        '        - "src/**/*Tests.cpp"',
        '        - "tests/helpers/**"',
        "",
        "    functions:",
        "      # Control which functions are included in function-level coverage.",
        "      #",
        "      # Patterns can be fully qualified names (e.g. Namespace::Class::Method) or",
        "      # wildcard expressions using '*'.",
        "      include:",
        '        - "*"  # Include all functions by default',
        "",
        "      # Exclude specific functions (or patterns) from function-level coverage.",
        "      # These are compiler-generated or runtime functions that add noise.",
        "      exclude:",
        "        # MSVC empty global delete (generated by compiler)",
        '        - "__empty_global_delete"',
        "",
        "        # CRT startup/initialization functions",
        '        - "__scrt_*"',
        '        - "_RTC_*"',
        '        - "__security_*"',
        '        - "__GSHandler*"',
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

function getWorkspaceStateKey(workspaceFolder?: vscode.WorkspaceFolder): string {
    return workspaceFolder?.uri.toString() ?? "__no_workspace__";
}

function getOrCreateCoverageState(
    workspaceFolder?: vscode.WorkspaceFolder,
): CoverageWorkspaceState {
    const key = getWorkspaceStateKey(workspaceFolder);
    let state = coverageStates.get(key);
    if (!state) {
        state = new CoverageWorkspaceState(
            workspaceFolder,
            new CoverageWorkspaceSession(CovdbParser),
        );
        coverageStates.set(key, state);
    } else if (workspaceFolder) {
        state.workspaceFolder = workspaceFolder;
    }
    return state;
}

function getWorkspaceFolderForPath(filePath: string): vscode.WorkspaceFolder | undefined {
    const exactFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    return exactFolder ?? getPreferredWorkspaceFolder(filePath);
}

function getCoverageStateForPath(filePath: string): CoverageWorkspaceState | undefined {
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

    disposeCovdbWatcher(stateKey);
    state.session.clear();

    if (clearEditors) {
        for (const editor of vscode.window.visibleTextEditors) {
            const editorFolder = getWorkspaceFolderForPath(editor.document.uri.fsPath);
            if (getWorkspaceStateKey(editorFolder) === stateKey) {
                decorator.clearDecorations(editor);
            }
        }
    }
}

function pruneCoverageStates(workspaceFolders: readonly vscode.WorkspaceFolder[]): void {
    const validKeys = new Set(workspaceFolders.map((folder) => getWorkspaceStateKey(folder)));
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

async function getMostRecentFile(files: vscode.Uri[]): Promise<vscode.Uri | undefined> {
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

async function getMostRecentPath(paths: string[]): Promise<string | undefined> {
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
    testingController = vscode.tests.createTestController("covdbg.testController", "covdbg");
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
        const item = testingController.createTestItem(id, path.basename(binaryPath));
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
                const execution = await executeCoverageRun(
                    context,
                    targetExecutablePath,
                    batchMode ? buildBatchIntermediateOutputPath(targetExecutablePath) : undefined,
                );
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

function collectTopLevelTestItems(controller: vscode.TestController): vscode.TestItem[] {
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

    item.children.forEach((child) => collectLeafTestItems(child, excludedIds, collected));
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

function getExecutablePathForTestItem(item: vscode.TestItem): string | undefined {
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
        : vscode.workspace.workspaceFolders?.map((f) => path.normalize(f.uri.fsPath).toLowerCase());
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
