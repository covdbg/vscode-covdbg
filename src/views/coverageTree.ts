import * as path from "path";
import * as vscode from "vscode";
import type { AuthService, AuthState } from "../auth/authService";
import type { CovdbFileSummary } from "../coverage/covdbParser";
import { describeRuntimeProblem } from "../runner/executableResolver";
import { APP_URL, PROFILE_URL, type RunNotice } from "../runner/runOutcome";
import type { RuntimeSource, RuntimeState } from "../runner/runnerTypes";

/** States the view shows with fixed welcome text from package.json (`covdbg.welcome`). */
export type WelcomeState = "unsupported" | "runtime" | "runtimeSetting" | "signedOut" | "noTarget";

/** What one workspace folder has loaded, or why its last load showed nothing. */
export interface FolderCoverage {
    folderName?: string;
    covdbPath?: string;
    /** When the .covdb was written, in ms since the epoch. */
    mtime: number;
    files: readonly CovdbFileSummary[];
    problem?: string;
}

export interface CoverageViewInput {
    auth: AuthState;
    runtime?: RuntimeState;
    notice?: RunNotice;
    /** Discovered test executables, as shown to the user, best first. */
    targets: readonly string[];
    coverage: readonly FolderCoverage[];
    multiRoot: boolean;
    now: number;
}

/** One row of the tree, free of vscode types so the view's states can be tested. */
export interface CoverageRow {
    /** Stable across refreshes, so the tree keeps what the user expanded. */
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    icon?: string;
    /** Selects the row's inline actions in package.json. */
    contextValue?: string;
    command?: string;
    /** A file the row opens. */
    filePath?: string;
    /** A web page the row opens. */
    url?: string;
    children?: CoverageRow[];
}

export interface CoverageView {
    welcome?: WelcomeState;
    rows: CoverageRow[];
}

const LOWEST_FILE_COUNT = 5;

/**
 * Decides what the Coverage view shows. Coverage, once there is any, always shows; before that,
 * the first of these that applies wins: covdbg cannot run here, covdbg is missing or too old, not
 * signed in, no test executable.
 */
export function describeCoverageView(input: CoverageViewInput): CoverageView {
    const loaded = input.coverage.filter((folder) => folder.files.length > 0);
    const problems = input.coverage.filter((folder) => folder.problem);
    const hasContent = loaded.length > 0 || problems.length > 0;
    const { auth } = input;

    if (!hasContent) {
        const welcome = describeWelcome(auth, input.targets.length);
        if (welcome) {
            return { welcome, rows: [] };
        }
    }

    const rows: CoverageRow[] = [];
    if (auth.kind === "signingIn") {
        rows.push({
            id: "signingIn",
            label: `Confirm code ${auth.code} in your browser.`,
            icon: "key",
            contextValue: "signingIn",
        });
    }

    for (const folder of loaded) {
        rows.push(describeSummary(folder, input.multiRoot, input.now));
    }
    for (const folder of problems) {
        const prefix = input.multiRoot && folder.folderName ? `${folder.folderName}: ` : "";
        rows.push({
            id: `problem:${folder.folderName ?? ""}`,
            label: `${prefix}${folder.problem}`,
            tooltip: folder.problem,
            icon: "warning",
        });
    }

    if (input.notice) {
        rows.push(describeNotice(input.notice));
    }

    const canRun = auth.kind === "signedIn" || auth.kind === "token" || auth.kind === "error";
    if (loaded.length === 0 && canRun && input.targets.length > 0) {
        rows.push({
            id: "ready",
            label:
                input.targets.length === 1
                    ? `Ready: ${input.targets[0]}`
                    : `Ready: ${input.targets.length} test executables`,
            tooltip: input.targets.join("\n"),
            icon: "beaker",
            contextValue: "ready",
        });
    }

    if (loaded.length > 0) {
        rows.push(describeLowest(loaded));
    }

    const account = describeAccount(auth);
    if (account) {
        rows.push({
            id: "account",
            ...account,
            description: describeRuntime(input.runtime),
        });
    }
    return { rows };
}

function describeWelcome(auth: AuthState, targetCount: number): WelcomeState | undefined {
    switch (auth.kind) {
        case "unavailable":
            if (auth.runtime.kind === "unsupported") {
                return "unsupported";
            }
            return auth.runtime.kind === "tooOld" && auth.runtime.fromSetting
                ? "runtimeSetting"
                : "runtime";
        case "signedOut":
            return "signedOut";
        case "signedIn":
        case "token":
        case "error":
            return targetCount === 0 ? "noTarget" : undefined;
        default:
            return undefined;
    }
}

function describeSummary(folder: FolderCoverage, multiRoot: boolean, now: number): CoverageRow {
    let covered = 0;
    let total = 0;
    for (const file of folder.files) {
        covered += file.coveredLines;
        total += file.totalLines;
    }
    const percent = total > 0 ? (covered / total) * 100 : 0;
    const prefix = multiRoot && folder.folderName ? `${folder.folderName}: ` : "";
    const count = folder.files.length;
    return {
        id: `summary:${folder.folderName ?? ""}`,
        label: `${prefix}${percent.toFixed(1)}% lines · ${count} ${count === 1 ? "file" : "files"} · ${formatAge(now - folder.mtime)}`,
        tooltip: folder.covdbPath,
        icon: "graph",
        command: "covdbg.showReport",
    };
}

function describeNotice(notice: RunNotice): CoverageRow {
    const row: CoverageRow = { id: "notice", label: notice.message, icon: "warning" };
    if (notice.action === "signIn") {
        row.command = "covdbg.signIn";
    } else if (notice.action) {
        row.url = notice.action === "openProfile" ? PROFILE_URL : APP_URL;
    }
    return row;
}

function describeLowest(loaded: readonly FolderCoverage[]): CoverageRow {
    const lowest = loaded
        .flatMap((folder) => folder.files)
        .filter((file) => file.totalLines > 0)
        .sort((left, right) => left.coveragePercent - right.coveragePercent)
        .slice(0, LOWEST_FILE_COUNT);
    return {
        id: "lowest",
        label: "Lowest coverage",
        children: [
            ...lowest.map((file) => ({
                id: `lowest:${file.filePath}`,
                label: path.basename(file.filePath),
                description: `${file.coveragePercent.toFixed(1)}%`,
                tooltip: file.filePath,
                filePath: file.filePath,
            })),
            {
                id: "lowest:all",
                label: "Show all",
                icon: "list-flat",
                command: "covdbg.browseFiles",
            },
        ],
    };
}

function describeAccount(auth: AuthState): Omit<CoverageRow, "id"> | undefined {
    switch (auth.kind) {
        case "unknown":
            return { label: "Checking covdbg…", icon: "loading~spin" };
        case "unavailable":
            return { label: describeRuntimeProblem(auth.runtime), icon: "warning" };
        case "token":
            return { label: "Using project token (COVDBG_PROJECT_TOKEN)", icon: "key" };
        case "signedIn":
            return {
                label: auth.email ? `Signed in as ${auth.email}` : "Signed in",
                icon: "account",
            };
        case "signedOut":
            return {
                label: "Not signed in",
                icon: "account",
                command: "covdbg.signIn",
            };
        case "error":
            return { label: `Could not check the sign-in: ${auth.message}`, icon: "warning" };
        case "signingIn":
            return undefined;
    }
}

const SOURCE_LABELS: Record<RuntimeSource, string> = {
    setting: "setting",
    path: "PATH",
    install: "installed",
    bundled: "bundled",
    cache: "portable cache",
};

/** Which covdbg runs, as `covdbg 1.3.0 (PATH)`. */
export function describeRuntime(runtime: RuntimeState | undefined): string | undefined {
    return runtime?.kind === "ok"
        ? `covdbg ${runtime.version} (${SOURCE_LABELS[runtime.source]})`
        : undefined;
}

export function formatAge(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) {
        return "just now";
    }
    if (minutes < 60) {
        return `${minutes} min ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours} h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The view's badge: set while nothing can run until the user acts. */
function describeBadge(state: AuthState): vscode.ViewBadge | undefined {
    if (state.kind === "signedOut") {
        return { value: 1, tooltip: "Sign in to covdbg" };
    }
    if (state.kind === "unavailable" && state.runtime.kind !== "unsupported") {
        return { value: 1, tooltip: describeRuntimeProblem(state.runtime) };
    }
    return undefined;
}

export interface CoverageTreeDeps {
    getCoverage: () => FolderCoverage[];
    getTargets: () => string[];
}

/**
 * The Coverage view. It is redrawn when coverage, the sign-in, covdbg or the targets change, never
 * on an editor switch.
 */
export class CoverageTree implements vscode.TreeDataProvider<CoverageRow>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly view: vscode.TreeView<CoverageRow>;
    private readonly disposables: vscode.Disposable[];
    private rows: CoverageRow[] = [];

    constructor(
        private readonly auth: AuthService,
        private readonly deps: CoverageTreeDeps,
    ) {
        this.view = vscode.window.createTreeView("covdbg.homeView", { treeDataProvider: this });
        this.disposables = [
            this.view,
            this.changed,
            auth.onDidChange(() => this.refresh()),
            // Opening the view is when a sign-in made in a terminal gets noticed.
            this.view.onDidChangeVisibility((event) => {
                if (event.visible) {
                    void auth.refresh();
                }
            }),
        ];
        this.refresh();
    }

    /** Works out the view again; the badge and the context keys matter while it is hidden, too. */
    refresh(): void {
        const coverage = this.deps.getCoverage();
        const view = describeCoverageView({
            auth: this.auth.state,
            runtime: this.auth.runtime,
            notice: this.auth.lastRunNotice,
            targets: this.deps.getTargets(),
            coverage,
            multiRoot: (vscode.workspace.workspaceFolders?.length ?? 0) > 1,
            now: Date.now(),
        });
        this.rows = view.rows;
        void vscode.commands.executeCommand("setContext", "covdbg.welcome", view.welcome ?? "");
        void vscode.commands.executeCommand(
            "setContext",
            "covdbg.hasCoverage",
            coverage.some((folder) => folder.files.length > 0),
        );
        this.view.badge = describeBadge(this.auth.state);
        this.changed.fire();
    }

    dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
    }

    getTreeItem(row: CoverageRow): vscode.TreeItem {
        const item = new vscode.TreeItem(
            row.label,
            row.children
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = row.id;
        item.description = row.description;
        item.tooltip = row.tooltip;
        item.contextValue = row.contextValue;
        if (row.icon) {
            item.iconPath = new vscode.ThemeIcon(row.icon);
        }
        if (row.filePath) {
            const uri = vscode.Uri.file(row.filePath);
            item.resourceUri = uri;
            item.command = { command: "vscode.open", title: "Open", arguments: [uri] };
        } else if (row.url) {
            const uri = vscode.Uri.parse(row.url);
            item.command = { command: "vscode.open", title: "Open", arguments: [uri] };
        } else if (row.command) {
            item.command = { command: row.command, title: row.label };
        }
        return item;
    }

    getChildren(row?: CoverageRow): CoverageRow[] {
        return row ? (row.children ?? []) : this.rows;
    }
}
