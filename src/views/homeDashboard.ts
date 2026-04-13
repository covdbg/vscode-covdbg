import * as vscode from "vscode";

export type DashboardTone = "good" | "warn" | "bad" | "muted";

export interface HomeStatusItem {
    label: string;
    value: string;
    detail?: string;
    tone: DashboardTone;
}

export interface HomeSetupStep {
    label: string;
    detail: string;
    done: boolean;
    blocked?: boolean;
    command?: string;
    commandLabel?: string;
}

export interface HomeAction {
    label: string;
    command: string;
    args?: string[];
}

export interface HomeWorkspaceItem {
    label: string;
    detail?: string;
    config: string;
    coverageDb: string;
    coverage: string;
    actions: HomeAction[];
    tone: DashboardTone;
    active?: boolean;
    expanded?: boolean;
}

export interface HomeDashboardData {
    statusItems: HomeStatusItem[];
    workspaceItems: HomeWorkspaceItem[];
    setupSteps: HomeSetupStep[];
    setupExpanded: boolean;
    actions: HomeAction[];
    logs: HomeAction[];
}

interface DashboardCommandMessage {
    command?: string;
    args?: string[];
}

export class CovdbgHomeDashboardView
    implements vscode.WebviewViewProvider, vscode.Disposable
{
    private view: vscode.WebviewView | undefined;
    private data: HomeDashboardData = createPlaceholderData();
    private readonly disposables: vscode.Disposable[] = [];

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true };
        this.disposables.push(
            view.onDidDispose(() => {
                if (this.view === view) {
                    this.view = undefined;
                }
            }),
            view.webview.onDidReceiveMessage((msg: DashboardCommandMessage) =>
                this.handleMessage(msg),
            ),
        );
        this.render();
    }

    update(data: HomeDashboardData): void {
        this.data = data;
        this.render();
    }

    dispose(): void {
        this.view = undefined;
        while (this.disposables.length > 0) {
            this.disposables.pop()?.dispose();
        }
    }

    private async handleMessage(msg: DashboardCommandMessage): Promise<void> {
        if (!msg.command) {
            return;
        }

        try {
            await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            void vscode.window.showWarningMessage(
                `covdbg: Failed to run command: ${text}`,
            );
        }
    }

    private render(): void {
        if (!this.view) {
            return;
        }

        this.view.webview.html = renderHtml(this.view.webview, this.data);
    }
}

function createPlaceholderData(): HomeDashboardData {
    return {
        statusItems: [
            { label: "Runtime", value: "Resolving...", tone: "muted" },
            { label: "License", value: "Resolving...", tone: "muted" },
            { label: "Config", value: "Resolving...", tone: "muted" },
            { label: "Coverage", value: "Resolving...", tone: "muted" },
        ],
        workspaceItems: [],
        setupSteps: [],
        setupExpanded: true,
        actions: [],
        logs: [],
    };
}

function renderHtml(webview: vscode.Webview, data: HomeDashboardData): string {
    const nonce = createNonce();
    const statusHtml = data.statusItems.map(renderStatusItem).join("");
    const workspaceHtml = data.workspaceItems.map(renderWorkspaceSection).join("");
    const stepsHtml = data.setupSteps.map(renderStep).join("");
    const actionsHtml = data.actions.map(renderActionListItem).join("");
    const logsHtml = data.logs.map(renderActionListItem).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.4;
    background: transparent;
}
.view {
    padding: 8px 12px 14px;
}
.section + .section {
    margin-top: 8px;
}
.section-toggle {
    display: block;
    cursor: pointer;
    list-style: none;
    padding: 0 0 6px;
}
.section-toggle::-webkit-details-marker {
    display: none;
}
.section-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
}
.section-label::before {
    content: "▾";
    display: inline-block;
    width: 12px;
    margin-right: 4px;
    color: var(--vscode-descriptionForeground);
}
details:not([open]) > summary .section-label::before {
    content: "▸";
}
.section-body {
    padding-left: 16px;
}
.status-list {
    display: grid;
    gap: 10px;
}
.status-card {
    display: grid;
    gap: 3px;
    padding: 2px 0;
}
.workspace-list {
    display: grid;
    gap: 8px;
}
.workspace-card {
    padding: 2px 0;
}
.workspace-toggle {
    display: block;
    cursor: pointer;
    list-style: none;
    padding: 0;
}
.workspace-toggle::-webkit-details-marker {
    display: none;
}
.workspace-toggle::before {
    content: "▾";
    display: inline-block;
    width: 12px;
    margin-right: 4px;
    color: var(--vscode-descriptionForeground);
}
details.workspace-card:not([open]) > summary.workspace-toggle::before {
    content: "▸";
}
.workspace-body {
    display: grid;
    gap: 3px;
    padding-top: 3px;
}
.workspace-head {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
}
.workspace-label {
    min-width: 0;
    word-break: break-word;
}
.workspace-badge {
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) - 1px);
}
.workspace-detail,
.workspace-meta {
    display: block;
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) - 1px);
    line-height: 1.35;
    padding-left: 15px;
}
.workspace-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 15px;
    padding-top: 2px;
}
.workspace-action {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: calc(var(--vscode-font-size) - 1px);
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
}
.workspace-action:hover {
    color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
    text-decoration: underline;
}
.status-head {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
}
.status-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
.dot-good  { background: var(--vscode-testing-iconPassed, #73c991); }
.dot-warn  { background: var(--vscode-editorWarning-foreground, #cca700); }
.dot-bad   { background: var(--vscode-testing-iconFailed, #f14c4c); }
.dot-muted { background: var(--vscode-disabledForeground, #6e6e6e); }
.status-label {
    color: var(--vscode-descriptionForeground);
    min-width: 0;
}
.status-value {
    min-width: 0;
    word-break: break-word;
    line-height: 1.35;
    padding-left: 15px;
}
.status-detail {
    display: block;
    margin-top: 2px;
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) - 1px);
    line-height: 1.35;
    padding-left: 15px;
}
.step {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    column-gap: 8px;
    align-items: start;
    padding: 5px 0;
}
.step-icon {
    width: 16px;
    text-align: center;
    line-height: 1.4;
    padding-top: 1px;
}
.step-done  { color: var(--vscode-testing-iconPassed, #73c991); }
.step-todo  { color: var(--vscode-descriptionForeground); }
.step-block { color: var(--vscode-testing-iconFailed, #f14c4c); }
.step-body {
    min-width: 0;
    line-height: 1.35;
}
.step-label {
    display: block;
}
.step-detail {
    display: block;
    margin-top: 1px;
    color: var(--vscode-descriptionForeground);
    font-size: calc(var(--vscode-font-size) - 1px);
    line-height: 1.35;
}
.step-action {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: calc(var(--vscode-font-size) - 1px);
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
}
.step-action:hover {
    color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
    text-decoration: underline;
}
.action-list {
    padding: 0;
    list-style: none;
}
.action-item {
    padding: 3px 0;
}
.action-link {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
}
.action-link:hover {
    color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
    text-decoration: underline;
}
</style>
</head>
<body>
<div class="view">
    <details class="section" open>
        <summary class="section-toggle"><span class="section-label">Quick Actions</span></summary>
        <div class="section-body">
            <ul class="action-list">${actionsHtml}</ul>
        </div>
    </details>

    <details class="section"${data.setupExpanded ? " open" : ""}>
        <summary class="section-toggle"><span class="section-label">Setup</span></summary>
        <div class="section-body">
            ${stepsHtml || '<div class="step"><span class="step-icon step-todo">○</span><span class="step-body"><span class="step-detail">Collecting workspace state...</span></span></div>'}
        </div>
    </details>

    <details class="section" open>
        <summary class="section-toggle"><span class="section-label">Status</span></summary>
        <div class="section-body">
            <div class="status-list">${statusHtml}</div>
        </div>
    </details>

    ${workspaceHtml || '<details class="section" open><summary class="section-toggle"><span class="section-label">Workspace</span></summary><div class="section-body"><span class="workspace-detail">Open a workspace folder to see per-folder coverage status.</span></div></details>'}

    <details class="section" open>
        <summary class="section-toggle"><span class="section-label">Logs</span></summary>
        <div class="section-body">
            <ul class="action-list">${logsHtml || '<li class="action-item"><span class="status-detail">No covdbg log file found yet.</span></li>'}</ul>
        </div>
    </details>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', e => {
    const btn = e.target.closest('[data-command]');
    if (!btn) return;
    const cmd = btn.getAttribute('data-command');
    const rawArgs = btn.getAttribute('data-command-args');
    const args = rawArgs ? JSON.parse(rawArgs) : [];
    if (cmd) vscode.postMessage({ command: cmd, args });
});
</script>
</body>
</html>`;
}

function renderStatusItem(item: HomeStatusItem): string {
    const detailHtml = item.detail
        ? `<span class="status-detail">${esc(item.detail)}</span>`
        : "";
    return `<div class="status-card">
    <div class="status-head">
        <span class="status-dot dot-${item.tone}"></span>
        <span class="status-label">${esc(item.label)}</span>
    </div>
    <span class="status-value">${esc(item.value)}</span>
    ${detailHtml}
</div>`;
}

function renderWorkspaceSection(item: HomeWorkspaceItem): string {
    const detailHtml = item.detail
        ? `<span class="workspace-detail">${esc(item.detail)}</span>`
        : "";
    const badgeHtml = item.active
        ? '<span class="workspace-badge">active</span>'
        : "";
    const actionsHtml = item.actions.length > 0
        ? `<div class="workspace-actions">${item.actions.map((action) => renderAction(action, "workspace-action")).join("")}</div>`
        : "";
    return `<details class="section"${item.expanded ? " open" : ""}>
    <summary class="section-toggle"><span class="section-label">Workspace: ${esc(item.label)}</span></summary>
    <div class="section-body">
        <div class="workspace-card">
            <div class="workspace-head">
                <span class="status-dot dot-${item.tone}"></span>
                <span class="workspace-label">${esc(item.label)}</span>
                ${badgeHtml}
            </div>
            <div class="workspace-body">
                ${detailHtml}
                <span class="workspace-meta">Config: ${esc(item.config)}</span>
                <span class="workspace-meta">Coverage DBs: ${esc(item.coverageDb)}</span>
                <span class="workspace-meta">Coverage: ${esc(item.coverage)}</span>
                ${actionsHtml}
            </div>
        </div>
    </div>
</details>`;
}

function renderStep(step: HomeSetupStep): string {
    const iconClass = step.blocked ? "step-block" : step.done ? "step-done" : "step-todo";
    const icon = step.blocked ? "✖" : step.done ? "✔" : "○";
    const actionHtml = step.command
        ? ` <button class="step-action" data-command="${esc(step.command)}">${esc(step.commandLabel ?? "Fix")}</button>`
        : "";
    return `<div class="step">
    <span class="step-icon ${iconClass}">${icon}</span>
    <span class="step-body">
        <span class="step-label">${esc(step.label)}</span>
        <span class="step-detail">${esc(step.detail)}${actionHtml}</span>
    </span>
</div>`;
}

function renderAction(action: HomeAction, className = "action-link"): string {
    const argsJson = esc(JSON.stringify(action.args ?? []));
    return `<button class="${className}" data-command="${esc(action.command)}" data-command-args="${argsJson}">${esc(action.label)}</button>`;
}

function renderActionListItem(action: HomeAction): string {
    return `<li class="action-item">${renderAction(action)}</li>`;
}

function esc(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function createNonce(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let nonce = "";
    for (let i = 0; i < 16; i += 1) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
