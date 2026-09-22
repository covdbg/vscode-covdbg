import * as vscode from "vscode";
import * as output from "../views/outputChannel";
import { describeRuntimeProblem } from "../runner/executableResolver";
import type { RunnerSettings, RuntimeState } from "../runner/runnerTypes";
import { isCovdbgRunnable } from "./preflight";
import {
    getPreferredWorkspaceFolder,
    readRunnerSettings,
    resolveRunnerPaths,
} from "../runner/settings";

/**
 * The id contributed in package.json under `contributes.mcpServerDefinitionProviders`.
 *
 * Registration must use exactly this string. There is no JSON schema for that contribution point
 * in @types/vscode, so nothing but the manifest test catches a mismatch between the two.
 */
export const COVDBG_MCP_PROVIDER_ID = "covdbg.mcp";

/** The label shown for the server in the MCP UI, and the one contributed in package.json. */
export const COVDBG_MCP_SERVER_LABEL = "covdbg";

export interface McpServerDeps {
    resolveRuntime: (settings: RunnerSettings, workspaceRoot: string) => Promise<RuntimeState>;
    /** Why the last check found no usable covdbg, or undefined when it found one or none ran yet. */
    runtimeProblem: () => Exclude<RuntimeState, { kind: "ok" }> | undefined;
}

/**
 * Whether this window can run covdbg at all.
 *
 * The same three conditions the runner enforces before it will spawn anything. A definition
 * offered where they do not hold would resolve to a server that cannot start - and offering one
 * in an untrusted window would break the promise package.json's capabilities.untrustedWorkspaces
 * makes about running coverage binaries.
 */
function canRunCovdbg(): boolean {
    return isCovdbgRunnable({
        platform: process.platform,
        isTrusted: vscode.workspace.isTrusted,
        remoteName: vscode.env.remoteName,
    });
}

/**
 * Offers covdbg's own MCP server to the editor.
 *
 * One server per window (decision D-F): every tool call carries its own database or executable
 * path, so a server per workspace folder would buy nothing but idle covdbg processes and a
 * uniquing scheme for a readonly label.
 */
export class CovdbgMcpServerDefinitionProvider
    implements
        vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>,
        vscode.Disposable
{
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeMcpServerDefinitions = this.changed.event;

    constructor(private readonly deps: McpServerDeps) {}

    /** Asks the editor for the definitions again: trust, folders, covdbg or its settings changed. */
    refresh(): void {
        this.changed.fire();
    }

    dispose(): void {
        this.changed.dispose();
    }

    /**
     * Called eagerly, including on chat submission, so it must not block.
     *
     * It reads settings only; the executable is located, and the portable archive possibly
     * expanded, in resolveMcpServerDefinition. The command below is a placeholder that resolve
     * replaces. Everything else is filled in here, so a changed covdbg.runner.env shows up as a
     * changed definition when {@link refresh} fires.
     */
    provideMcpServerDefinitions(): vscode.McpStdioServerDefinition[] {
        const workspaceFolder = getPreferredWorkspaceFolder();
        if (!canRunCovdbg() || this.deps.runtimeProblem() || !workspaceFolder) {
            return [];
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const settings = readRunnerSettings(workspaceFolder.uri);
        const paths = resolveRunnerPaths(settings, workspaceRoot);

        // The server holds no licence: each run it spawns is decided from the machine's sign-in
        // (`covdbg login`) or from COVDBG_PROJECT_TOKEN in the environment it inherits.
        //
        // COVDBG_OUTPUT is where a run with no output_path of its own lands. Without it the
        // server writes into a temporary directory that nothing here watches, so a model could
        // run coverage successfully and the editor would show nothing. Named once here rather
        // than on every call; a model that passes output_path still overrides it.
        const server = new vscode.McpStdioServerDefinition(
            COVDBG_MCP_SERVER_LABEL,
            "covdbg",
            ["mcp", "--workspace", workspaceRoot],
            {
                ...settings.env,
                COVDBG_OUTPUT: paths.configuredOutputPath,
            },
        );
        server.cwd = vscode.Uri.file(paths.workingDirectory);
        return [server];
    }

    /**
     * Called when the editor actually wants to start the server, where slow work is allowed.
     *
     * @returns The resolved server, or undefined when covdbg cannot be found
     */
    async resolveMcpServerDefinition(
        server: vscode.McpStdioServerDefinition,
    ): Promise<vscode.McpStdioServerDefinition | undefined> {
        const workspaceFolder = getPreferredWorkspaceFolder();
        if (!canRunCovdbg() || !workspaceFolder) {
            return undefined;
        }

        // This can expand the bundled portable archive and stat every entry on PATH, which is
        // exactly why it is here and not in provideMcpServerDefinitions.
        const resolved = await this.deps.resolveRuntime(
            readRunnerSettings(workspaceFolder.uri),
            workspaceFolder.uri.fsPath,
        );
        if (resolved.kind !== "ok") {
            output.logError(
                `covdbg: the MCP server was not started. ${describeRuntimeProblem(resolved)}`,
            );
            return undefined;
        }

        server.command = resolved.path;
        // A covdbg with different tool schemas should prompt the editor to refresh them.
        server.version = resolved.version;

        output.log(`covdbg: MCP server resolved to ${resolved.path} (${resolved.source})`);
        return server;
    }
}
