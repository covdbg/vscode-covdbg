import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CovdbFileSummary } from "../coverage/covdbParser";
import { resolveCovdbgExecutable } from "../runner/executableResolver";
import {
    LicenseStatusSnapshot,
    readLicenseStatus,
} from "../runner/licenseStatus";
import { getCovdbgVersion } from "../runner/runtimeInfo";
import {
    getPreferredWorkspaceFolder,
    getWorkspaceRoot,
    readRunnerSettings,
    resolveRunnerPaths,
} from "../runner/settings";
import {
    CovdbgHomeDashboardView,
    HomeAction,
    HomeSetupStep,
    HomeStatusItem,
    HomeWorkspaceItem,
} from "./homeDashboard";
import * as output from "./outputChannel";

export interface SidebarCoverageState {
    workspaceFolder?: vscode.WorkspaceFolder;
    activeCovdbPath?: string;
    fileIndex: Map<string, CovdbFileSummary>;
}

interface RuntimeSummary {
    checked: boolean;
    source?: "setting" | "bundled" | "path" | "install" | "cache";
    path?: string;
    version?: string;
    error?: string;
}

interface SidebarDependencies {
    createConfig: () => Promise<void>;
    createConfigInWorkspace: (
        workspaceFolder: vscode.WorkspaceFolder,
    ) => Promise<void>;
    discoverAndLoadIndex: () => Promise<void>;
    findCovdbgConfigFiles: (
        workspaceFolder?: vscode.WorkspaceFolder,
        maxResults?: number,
    ) => Promise<vscode.Uri[]>;
    findDiscoveredCovdbFiles: (
        workspaceFolder?: vscode.WorkspaceFolder,
    ) => Promise<vscode.Uri[]>;
    getActiveCoverageState: () => SidebarCoverageState | undefined;
    getWorkspaceCoverageState: (
        workspaceFolder?: vscode.WorkspaceFolder,
    ) => SidebarCoverageState | undefined;
    getWorkspaceFolderForPath: (
        filePath: string,
    ) => vscode.WorkspaceFolder | undefined;
    loadIndex: (
        covdbPath: string,
        source: "settings" | "auto-discovered",
        workspaceFolder?: vscode.WorkspaceFolder,
    ) => Promise<void>;
    refreshTestControllerItems: () => Promise<void>;
    setLicenseStatus: (
        licenseStatus: LicenseStatusSnapshot | undefined,
    ) => void;
}

export class CovdbgSidebarController implements vscode.Disposable {
    private readonly homeDashboard = new CovdbgHomeDashboardView();
    private lastLicenseStatus: LicenseStatusSnapshot | undefined;
    private lastDiscoveredTestCount = 0;
    private lastRuntimeSummary: RuntimeSummary = { checked: false };
    private dashboardRefreshTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly deps: SidebarDependencies,
    ) {}

    getDisposables(): vscode.Disposable[] {
        return [
            this.homeDashboard,
            vscode.window.registerWebviewViewProvider(
                "covdbg.homeView",
                this.homeDashboard,
            ),
            vscode.commands.registerCommand(
                "covdbg.pickDiscoveredCovdb",
                (workspaceFolderPath?: string) =>
                    this.pickDiscoveredCovdbCommand(workspaceFolderPath),
            ),
            vscode.commands.registerCommand(
                "covdbg.openConfig",
                (workspaceFolderPath?: string) =>
                    this.openConfigCommand(workspaceFolderPath),
            ),
            vscode.commands.registerCommand(
                "covdbg.openLog",
                (workspaceFolderPath?: string) =>
                    this.openLogCommand(workspaceFolderPath),
            ),
            vscode.commands.registerCommand(
                "covdbg.openAppDataFolder",
                (workspaceFolderPath?: string) =>
                    this.openAppDataFolderCommand(workspaceFolderPath),
            ),
            vscode.commands.registerCommand("covdbg.refreshDashboard", () =>
                this.refreshDashboardCommand(),
            ),
            vscode.commands.registerCommand("covdbg.openSettings", () =>
                vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "covdbg",
                ),
            ),
        ];
    }

    dispose(): void {
        if (this.dashboardRefreshTimer) {
            clearTimeout(this.dashboardRefreshTimer);
            this.dashboardRefreshTimer = undefined;
        }
        this.homeDashboard.dispose();
    }

    setDiscoveredTestCount(count: number): void {
        this.lastDiscoveredTestCount = count;
        this.scheduleRefresh();
    }

    setLicenseStatus(licenseStatus: LicenseStatusSnapshot | undefined): void {
        this.lastLicenseStatus = licenseStatus;
        this.deps.setLicenseStatus(licenseStatus);
        this.scheduleRefresh();
    }

    async refreshLicenseStatusFromDisk(): Promise<void> {
        const workspaceFolder = getPreferredWorkspaceFolder();
        const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
        if (!workspaceRoot) {
            this.setLicenseStatus(undefined);
            return;
        }

        const settings = readRunnerSettings(workspaceFolder?.uri);
        const paths = resolveRunnerPaths(settings, workspaceRoot);
        this.setLicenseStatus(await readLicenseStatus(paths.appDataPath));
    }

    async refreshRuntimeSummary(): Promise<void> {
        const workspaceFolder = getPreferredWorkspaceFolder();
        const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
        if (!workspaceRoot) {
            this.lastRuntimeSummary = {
                checked: true,
                error: "Open a workspace folder to resolve the covdbg runtime.",
            };
            this.scheduleRefresh();
            return;
        }

        const settings = readRunnerSettings(workspaceFolder?.uri);
        const resolved = await resolveCovdbgExecutable(
            this.context,
            settings,
            workspaceRoot,
        );
        if (!resolved) {
            this.lastRuntimeSummary = {
                checked: true,
                error: "covdbg.exe was not resolved. Use the bundled portable or set covdbg.executablePath.",
            };
            output.log("covdbg runtime: executable not resolved at activation");
            this.scheduleRefresh();
            return;
        }

        const version = await getCovdbgVersion(resolved.path);
        this.lastRuntimeSummary = {
            checked: true,
            source: resolved.source,
            path: resolved.path,
            version,
        };
        const versionInfo = version ? ` (${version})` : "";
        output.log(
            `covdbg runtime: using ${resolved.source} executable ${resolved.path}${versionInfo}`,
        );
        this.scheduleRefresh();
    }

    scheduleRefresh(): void {
        if (this.dashboardRefreshTimer) {
            clearTimeout(this.dashboardRefreshTimer);
        }

        this.dashboardRefreshTimer = setTimeout(() => {
            this.dashboardRefreshTimer = undefined;
            void this.refreshHomeDashboard();
        }, 75);
    }

    private async refreshDashboardCommand(): Promise<void> {
        await Promise.all([
            this.refreshRuntimeSummary(),
            this.refreshLicenseStatusFromDisk(),
            this.deps.refreshTestControllerItems(),
            this.deps.discoverAndLoadIndex(),
        ]);
        this.scheduleRefresh();
    }

    private async pickDiscoveredCovdbCommand(
        workspaceFolderPath?: string,
    ): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const targetWorkspace = workspaceFolderPath
            ? this.getWorkspaceFolderByFsPath(workspaceFolderPath)
            : undefined;
        const discoveredFiles = targetWorkspace
            ? await this.deps.findDiscoveredCovdbFiles(targetWorkspace)
            : await this.deps.findDiscoveredCovdbFiles();
        if (discoveredFiles.length === 0) {
            vscode.window.showInformationMessage(
                targetWorkspace
                    ? `covdbg: No discovered .covdb files found in ${targetWorkspace.name}.`
                    : "covdbg: No discovered .covdb files found in the current workspace.",
            );
            return;
        }

        const activeState = this.deps.getActiveCoverageState();
        const picks = discoveredFiles.map((uri) => {
            const workspaceFolder = this.deps.getWorkspaceFolderForPath(uri.fsPath);
            const relativePath = workspaceFolder
                ? this.shortenPath(uri.fsPath, workspaceFolder)
                : vscode.workspace.asRelativePath(uri.fsPath, false);
            return {
                label: relativePath || path.basename(uri.fsPath),
                description: workspaceFolder?.name,
                detail: uri.fsPath,
                uri,
                workspaceFolder,
                active: activeState?.activeCovdbPath === uri.fsPath,
            };
        });

        picks.sort((left, right) => {
            if (left.active !== right.active) {
                return left.active ? -1 : 1;
            }
            if ((left.description ?? "") !== (right.description ?? "")) {
                return (left.description ?? "").localeCompare(
                    right.description ?? "",
                );
            }
            return left.label.localeCompare(right.label);
        });

        const picked = await vscode.window.showQuickPick(
            picks.map((pick) => ({
                label: pick.active ? `$(check) ${pick.label}` : pick.label,
                description: pick.description,
                detail: pick.detail,
                uri: pick.uri,
                workspaceFolder: pick.workspaceFolder,
            })),
            {
                title: "covdbg: Pick discovered .covdb",
                placeHolder:
                    workspaceFolders.length > 1
                        ? "Select a discovered coverage database from any workspace folder"
                        : "Select a discovered coverage database",
                matchOnDescription: true,
                matchOnDetail: true,
            },
        );

        if (!picked) {
            return;
        }

        const target = picked.workspaceFolder;
        const config = vscode.workspace.getConfiguration("covdbg", target?.uri);
        const configuredPath = target
            ? this.toWorkspaceRelativeOrAbsolutePath(picked.uri.fsPath, target)
            : picked.uri.fsPath;
        await config.update(
            "covdbPath",
            configuredPath,
            target
                ? vscode.ConfigurationTarget.WorkspaceFolder
                : vscode.ConfigurationTarget.Workspace,
        );
        await this.deps.loadIndex(picked.uri.fsPath, "settings", target);
    }

    private async openConfigCommand(
        workspaceFolderPath?: string,
    ): Promise<void> {
        const activeWorkspace = workspaceFolderPath
            ? this.getWorkspaceFolderByFsPath(workspaceFolderPath)
            : getPreferredWorkspaceFolder(
                  vscode.window.activeTextEditor?.document.uri.fsPath,
              );
        const activeMatches = activeWorkspace
            ? await this.deps.findCovdbgConfigFiles(activeWorkspace)
            : [];

        if (activeMatches.length === 1) {
            const doc = await vscode.workspace.openTextDocument(activeMatches[0]);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            return;
        }

        if (activeMatches.length > 1) {
            const picked = await vscode.window.showQuickPick(
                activeMatches.map((uri) => ({
                    label: vscode.workspace.asRelativePath(uri.fsPath),
                    description: activeWorkspace?.name,
                    uri,
                })),
                {
                    title: "covdbg: Open .covdbg.yaml",
                    placeHolder: "Select the config file to open",
                    matchOnDescription: true,
                },
            );
            if (!picked) {
                return;
            }
            const doc = await vscode.workspace.openTextDocument(picked.uri);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            return;
        }

        if (activeWorkspace) {
            await this.deps.createConfigInWorkspace(activeWorkspace);
            return;
        }

        await this.deps.createConfig();
    }

    private async openLogCommand(
        workspaceFolderPath?: string,
    ): Promise<void> {
        const logPath = await this.getWorkspaceLogPath(workspaceFolderPath);
        if (!logPath) {
            vscode.window.showInformationMessage(
                workspaceFolderPath
                    ? `covdbg: No covdbg.log found for ${path.basename(workspaceFolderPath)} yet.`
                    : "covdbg: No covdbg.log found for the active workspace yet.",
            );
            return;
        }

        const doc = await vscode.workspace.openTextDocument(logPath);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    }

    private async openAppDataFolderCommand(
        workspaceFolderPath?: string,
    ): Promise<void> {
        const appDataPath = this.getWorkspaceAppDataPath(workspaceFolderPath);
        if (!appDataPath) {
            vscode.window.showInformationMessage(
                "covdbg: Open a workspace folder first.",
            );
            return;
        }

        await fs.mkdir(appDataPath, { recursive: true });
        await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(appDataPath),
        );
    }

    private async refreshHomeDashboard(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const hasWorkspace = workspaceFolders.length > 0;
        const activeState = this.deps.getActiveCoverageState();
        const activeWorkspace =
            activeState?.workspaceFolder ??
            getPreferredWorkspaceFolder(
                vscode.window.activeTextEditor?.document.uri.fsPath,
            );
        const workspaceRoot = activeWorkspace?.uri.fsPath;
        const settings = readRunnerSettings(activeWorkspace?.uri);
        const activeConfigFiles = activeWorkspace
            ? await this.deps.findCovdbgConfigFiles(activeWorkspace)
            : [];
        const discoveredCovdbFiles = activeWorkspace
            ? await this.deps.findDiscoveredCovdbFiles(activeWorkspace)
            : await this.deps.findDiscoveredCovdbFiles();
        const allDiscoveredCovdbFiles = await this.deps.findDiscoveredCovdbFiles();
        const allConfigFiles = await this.deps.findCovdbgConfigFiles();
        const workspaceItems = await this.buildWorkspaceDashboardItems(
            workspaceFolders,
            activeWorkspace,
        );

        let resolvedConfigPath: string | undefined;
        let activeAppDataPath: string | undefined;
        let activeLogPath: string | undefined;

        if (workspaceRoot) {
            const resolvedPaths = resolveRunnerPaths(settings, workspaceRoot);
            activeAppDataPath = resolvedPaths.appDataPath;
            if (settings.configPath) {
                resolvedConfigPath = (await this.fileExists(
                    resolvedPaths.configPath ?? "",
                ))
                    ? resolvedPaths.configPath
                    : undefined;
            } else if (activeConfigFiles.length > 0) {
                resolvedConfigPath = activeConfigFiles[0].fsPath;
            }
            activeLogPath = await this.findCovdbgLogPath(activeAppDataPath);
        }

        const hasConfig = Boolean(resolvedConfigPath || activeConfigFiles.length > 0);
        const runtimeChecked = this.lastRuntimeSummary.checked;
        const runtimeReady = Boolean(this.lastRuntimeSummary?.path);
        const coverageLoaded = Boolean(activeState?.activeCovdbPath);
        const fileIndex = activeState?.fileIndex ?? new Map();

        const statusItems: HomeStatusItem[] = [
            {
                label: "Runtime",
                value: !runtimeChecked
                    ? "Checking..."
                    : runtimeReady
                    ? `${this.formatRuntimeSource(this.lastRuntimeSummary?.source)}${this.lastRuntimeSummary?.version ? " " + this.lastRuntimeSummary.version : ""}`
                    : "Not resolved",
                detail: !runtimeChecked
                    ? "Resolving covdbg runtime for the active workspace."
                    : runtimeReady
                    ? this.shortenPath(this.lastRuntimeSummary?.path, activeWorkspace)
                    : this.lastRuntimeSummary?.error,
                tone: !runtimeChecked ? "muted" : runtimeReady ? "good" : "bad",
            },
            {
                label: "License",
                value: this.formatLicenseValue(this.lastLicenseStatus),
                detail: this.formatLicenseBrief(this.lastLicenseStatus),
                tone: this.getLicenseTone(this.lastLicenseStatus),
            },
            {
                label: "Workspace",
                value: activeWorkspace?.name ?? "No workspace folder",
                detail: hasWorkspace
                    ? workspaceFolders.length === 1
                        ? "Single-folder workspace"
                        : `${workspaceFolders.length} workspace folders open`
                    : undefined,
                tone: hasWorkspace ? "good" : "warn",
            },
            {
                label: "Config",
                value: hasConfig
                    ? this.shortenPath(
                          resolvedConfigPath ?? activeConfigFiles[0]?.fsPath,
                          activeWorkspace,
                      ) || ".covdbg.yaml"
                    : "Missing",
                tone: hasConfig ? "good" : "warn",
            },
            {
                label: "Coverage DBs",
                value: coverageLoaded
                    ? this.shortenPath(activeState?.activeCovdbPath, activeWorkspace) || "Active"
                    : discoveredCovdbFiles.length > 0
                        ? `${discoveredCovdbFiles.length} discovered`
                        : "None discovered",
                detail: hasWorkspace && workspaceFolders.length > 1
                    ? `${allDiscoveredCovdbFiles.length} total across all folders`
                    : discoveredCovdbFiles.length > 1
                        ? `${discoveredCovdbFiles.length} candidates in active workspace`
                        : undefined,
                tone: coverageLoaded || discoveredCovdbFiles.length > 0
                    ? "good"
                    : "warn",
            },
            {
                label: "Coverage",
                value: coverageLoaded
                    ? `${this.coveragePct(fileIndex)} — ${fileIndex.size} files`
                    : "No data loaded",
                detail: coverageLoaded
                    ? this.shortenPath(activeState?.activeCovdbPath, activeWorkspace)
                    : undefined,
                tone: coverageLoaded ? "good" : "muted",
            },
        ];

        const setupSteps: HomeSetupStep[] = [
            {
                label: "Workspace trusted",
                detail: hasWorkspace
                    ? vscode.workspace.isTrusted
                        ? "VS Code workspace trust is enabled, so the covdbg runner preflight passes."
                        : "Workspace trust is required because covdbg launches local binaries."
                    : "Open a workspace folder first.",
                done: hasWorkspace && vscode.workspace.isTrusted,
                blocked: hasWorkspace && !vscode.workspace.isTrusted,
                command: hasWorkspace && !vscode.workspace.isTrusted
                    ? "workbench.trust.manage"
                    : undefined,
                commandLabel: "Manage Trust",
            },
            {
                label: "covdbg runtime resolved",
                detail: !runtimeChecked
                    ? "Checking the covdbg runtime for the active workspace."
                    : runtimeReady
                    ? `Using ${this.formatRuntimeSource(this.lastRuntimeSummary?.source).toLowerCase()}.`
                    : "Set covdbg.executablePath or use the bundled portable.",
                done: runtimeReady,
                blocked: runtimeChecked && !runtimeReady,
                command: "covdbg.openSettings",
                commandLabel: "Settings",
            },
            {
                label: ".covdbg.yaml configured",
                detail: hasConfig
                    ? "File and function filters are active."
                    : "Scope files, exclude SDKs and third-party code.",
                done: hasConfig,
                command: hasConfig ? "covdbg.openConfig" : "covdbg.createConfig",
                commandLabel: hasConfig ? "Open" : "Create",
            },
            {
                label: "Runnable test target available",
                detail: this.lastDiscoveredTestCount > 0
                    ? `${this.lastDiscoveredTestCount} discovered test ${this.lastDiscoveredTestCount === 1 ? "binary is" : "binaries are"} available.`
                    : "No discovered test binaries yet.",
                done: this.lastDiscoveredTestCount > 0,
                command: this.lastDiscoveredTestCount > 0
                    ? "covdbg.runCoverage"
                    : "covdbg.refreshTestBinaries",
                commandLabel: this.lastDiscoveredTestCount > 0
                    ? "Run"
                    : "Refresh Tests",
            },
            {
                label: "Coverage data loaded",
                detail: coverageLoaded
                    ? `${fileIndex.size} files indexed.`
                    : "Run coverage or select a .covdb file.",
                done: coverageLoaded,
                command: coverageLoaded ? "covdbg.showReport" : "covdbg.runCoverage",
                commandLabel: coverageLoaded ? "Report" : "Run",
            },
        ];

        const setupExpanded =
            setupSteps.length === 0 ||
            setupSteps.some((step) => !step.done || Boolean(step.blocked));

        const actions: HomeAction[] = [
            { label: "Run Coverage", command: "covdbg.runCoverage" },
            { label: "Show Coverage Report", command: "covdbg.showReport" },
            {
                label: hasConfig ? "Open .covdbg.yaml" : "Create .covdbg.yaml",
                command: hasConfig ? "covdbg.openConfig" : "covdbg.createConfig",
            },
            {
                label: allDiscoveredCovdbFiles.length > 1
                    ? `Pick Discovered .covdb (${allDiscoveredCovdbFiles.length})`
                    : "Pick Discovered .covdb",
                command: "covdbg.pickDiscoveredCovdb",
            },
            { label: "Select .covdb File…", command: "covdbg.configurePath" },
            { label: "Open Settings", command: "covdbg.openSettings" },
        ];

        const logs: HomeAction[] = [];
        if (activeLogPath) {
            logs.push({ label: "Open covdbg.log", command: "covdbg.openLog" });
        }
        if (activeAppDataPath) {
            logs.push({
                label: "Open .covdbg Folder",
                command: "covdbg.openAppDataFolder",
            });
        }
        if (allConfigFiles.length > 1) {
            logs.push({
                label: `${allConfigFiles.length} config files detected`,
                command: "covdbg.openConfig",
            });
        }

        this.homeDashboard.update({
            statusItems,
            workspaceItems,
            setupSteps,
            setupExpanded,
            actions,
            logs,
        });
    }

    private coveragePct(fileIndex: Map<string, CovdbFileSummary>): string {
        let covered = 0;
        let total = 0;
        for (const summary of fileIndex.values()) {
            covered += summary.coveredLines;
            total += summary.totalLines;
        }
        return total > 0 ? `${((covered / total) * 100).toFixed(1)}%` : "0%";
    }

    private formatRuntimeSource(source?: RuntimeSummary["source"]): string {
        switch (source) {
            case "setting":
                return "Configured path";
            case "bundled":
                return "Bundled portable";
            case "path":
                return "PATH";
            case "install":
                return "Installed";
            case "cache":
                return "Portable cache";
            default:
                return "Unknown";
        }
    }

    private formatLicenseValue(
        licenseStatus?: LicenseStatusSnapshot,
    ): string {
        if (!licenseStatus?.status) {
            return "Unknown";
        }
        if (licenseStatus.status === "active") {
            return licenseStatus.source === "plugin-demo" ? "Demo" : "Active";
        }
        if (licenseStatus.status === "trial-used") {
            return "Demo expired";
        }
        return licenseStatus.status;
    }

    private formatLicenseBrief(
        licenseStatus?: LicenseStatusSnapshot,
    ): string | undefined {
        if (!licenseStatus) {
            return undefined;
        }
        if (
            licenseStatus.status === "active" &&
            licenseStatus.source === "plugin-demo"
        ) {
            return `${Math.max(0, licenseStatus.daysRemaining ?? 0)} days remaining`;
        }
        if (licenseStatus.status === "trial-used") {
            return "30-day demo already used";
        }
        return licenseStatus.message;
    }

    private getLicenseTone(
        licenseStatus?: LicenseStatusSnapshot,
    ): "good" | "warn" | "bad" | "muted" {
        if (!licenseStatus?.status) {
            return "warn";
        }
        if (licenseStatus.status === "active") {
            return "good";
        }
        if (licenseStatus.status === "trial-used") {
            return "bad";
        }
        return "warn";
    }

    private shortenPath(
        filePath: string | undefined,
        workspaceFolder?: vscode.WorkspaceFolder,
    ): string {
        if (!filePath) {
            return "";
        }
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
                return relativePath.replace(/\\/g, "/");
            }
        }
        if (vscode.workspace.workspaceFolders?.length) {
            return vscode.workspace.asRelativePath(filePath, false);
        }
        return filePath;
    }

    private toWorkspaceRelativeOrAbsolutePath(
        filePath: string,
        workspaceFolder: vscode.WorkspaceFolder,
    ): string {
        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
        if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
            return relativePath.replace(/\\/g, "/");
        }
        return filePath;
    }

    private getWorkspaceFolderByFsPath(
        workspaceFolderPath: string,
    ): vscode.WorkspaceFolder | undefined {
        const normalizedTarget = path.normalize(workspaceFolderPath).toLowerCase();
        return (vscode.workspace.workspaceFolders ?? []).find(
            (folder) =>
                path.normalize(folder.uri.fsPath).toLowerCase() === normalizedTarget,
        );
    }

    private async buildWorkspaceDashboardItems(
        workspaceFolders: readonly vscode.WorkspaceFolder[],
        activeWorkspace: vscode.WorkspaceFolder | undefined,
    ): Promise<HomeWorkspaceItem[]> {
        if (workspaceFolders.length === 0) {
            return [];
        }

        return Promise.all(
            workspaceFolders.map(async (folder) => {
                const state = this.deps.getWorkspaceCoverageState(folder);
                const configFiles = await this.deps.findCovdbgConfigFiles(folder, 1);
                const discoveredCovdbFiles =
                    await this.deps.findDiscoveredCovdbFiles(folder);
                const hasLoadedCoverage = Boolean(state?.activeCovdbPath);
                const isActive =
                    activeWorkspace?.uri.toString() === folder.uri.toString();
                const coverageValue = hasLoadedCoverage
                    ? `${this.coveragePct(state?.fileIndex ?? new Map())} — ${state?.fileIndex.size ?? 0} files`
                    : "No data loaded";
                const coverageDbValue = hasLoadedCoverage
                    ? `Loaded ${this.shortenPath(state?.activeCovdbPath, folder)}`
                    : discoveredCovdbFiles.length > 0
                        ? `${discoveredCovdbFiles.length} discovered`
                        : "None found";

                return {
                    label: folder.name,
                    detail: this.shortenPath(folder.uri.fsPath),
                    config: configFiles.length > 0
                        ? this.shortenPath(configFiles[0].fsPath, folder) || ".covdbg.yaml"
                        : "Missing",
                    coverageDb: coverageDbValue,
                    coverage: coverageValue,
                    actions: [
                        {
                            label: configFiles.length > 0
                                ? "Open Config"
                                : "Create Config",
                            command: "covdbg.openConfig",
                            args: [folder.uri.fsPath],
                        },
                        {
                            label: discoveredCovdbFiles.length > 0
                                ? discoveredCovdbFiles.length > 1
                                    ? `Pick .covdb (${discoveredCovdbFiles.length})`
                                    : "Pick .covdb"
                                : "Find .covdb",
                            command: "covdbg.pickDiscoveredCovdb",
                            args: [folder.uri.fsPath],
                        },
                        {
                            label: "Open Log",
                            command: "covdbg.openLog",
                            args: [folder.uri.fsPath],
                        },
                    ],
                    tone: hasLoadedCoverage
                        ? "good"
                        : discoveredCovdbFiles.length > 0 || configFiles.length > 0
                            ? "warn"
                            : "muted",
                    active: isActive,
                    expanded: isActive,
                };
            }),
        );
    }

    private getWorkspaceAppDataPath(
        workspaceFolderPath?: string,
    ): string | undefined {
        const activeWorkspace = workspaceFolderPath
            ? this.getWorkspaceFolderByFsPath(workspaceFolderPath)
            : getPreferredWorkspaceFolder(
                  vscode.window.activeTextEditor?.document.uri.fsPath,
              );
        const workspaceRoot = activeWorkspace?.uri.fsPath ?? getWorkspaceRoot();
        if (!workspaceRoot) {
            return undefined;
        }

        const settings = readRunnerSettings(activeWorkspace?.uri);
        return resolveRunnerPaths(settings, workspaceRoot).appDataPath;
    }

    private async getWorkspaceLogPath(
        workspaceFolderPath?: string,
    ): Promise<string | undefined> {
        const appDataPath = this.getWorkspaceAppDataPath(workspaceFolderPath);
        if (!appDataPath) {
            return undefined;
        }
        return this.findCovdbgLogPath(appDataPath);
    }

    private async findCovdbgLogPath(
        appDataPath: string,
    ): Promise<string | undefined> {
        const candidatePaths = [
            path.join(appDataPath, "covdbg.log"),
            path.join(appDataPath, "Logs", "covdbg.log"),
        ];

        for (const candidatePath of candidatePaths) {
            if (await this.fileExists(candidatePath)) {
                return candidatePath;
            }
        }

        return undefined;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
