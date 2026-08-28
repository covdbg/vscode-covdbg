import * as vscode from "vscode";
import * as output from "../views/outputChannel";
import { resolveCovdbgExecutable } from "../runner/executableResolver";
import { buildLicenseRunConfig } from "../runner/licenseRunConfig";
import { getCovdbgVersion } from "../runner/runtimeInfo";
import { isCovdbgRunnable } from "./preflight";
import {
    getPreferredWorkspaceFolder,
    getWorkspaceRoot,
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
export class CovdbgMcpServerDefinitionProvider implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> {
    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called eagerly, including on chat submission, so it must not block.
     *
     * It therefore does no resolution at all: the executable is located, and the portable archive
     * possibly expanded, in resolveMcpServerDefinition instead. The command below is a placeholder
     * that resolve replaces.
     */
    provideMcpServerDefinitions(): vscode.McpStdioServerDefinition[] {
        if (!canRunCovdbg()) {
            return [];
        }

        return [new vscode.McpStdioServerDefinition(COVDBG_MCP_SERVER_LABEL, "covdbg", ["mcp"])];
    }

    /**
     * Called when the editor actually wants to start the server, where slow work is allowed.
     *
     * @returns The resolved server, or undefined when covdbg cannot be found
     */
    async resolveMcpServerDefinition(
        server: vscode.McpStdioServerDefinition,
    ): Promise<vscode.McpStdioServerDefinition | undefined> {
        if (!canRunCovdbg()) {
            return undefined;
        }

        const workspaceFolder = getPreferredWorkspaceFolder();
        const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
        if (!workspaceRoot) {
            output.logError(
                "covdbg: no workspace folder is open, so the MCP server was not started.",
            );
            return undefined;
        }

        const settings = readRunnerSettings(workspaceFolder?.uri);

        // This can expand the bundled portable archive and stat every entry on PATH, which is
        // exactly why it is here and not in provideMcpServerDefinitions.
        const resolved = await resolveCovdbgExecutable(this.context, settings, workspaceRoot);
        if (!resolved) {
            output.logError(
                "covdbg: no covdbg.exe could be found, so the MCP server was not started. Set " +
                    "covdbg.executablePath, or put covdbg.exe on PATH.",
            );
            return undefined;
        }

        server.command = resolved.path;
        server.args = ["mcp"];

        // Environment, never arguments. covdbg accepts --demo and friends on the mcp subcommand,
        // because they are global options, but the server itself holds no licence and does not
        // pass them on: each run it spawns builds its own licence arguments from the environment
        // it inherits. Giving them here would be silently ignored.
        const license = buildLicenseRunConfig(settings);
        const paths = resolveRunnerPaths(settings, workspaceRoot);

        // COVDBG_OUTPUT is where a run with no output_path of its own lands. Without it the
        // server writes into a temporary directory that nothing here watches, so a model could
        // run coverage successfully and the editor would show nothing. Named once here rather
        // than on every call; a model that passes output_path still overrides it.
        const env: Record<string, string> = { ...license.env };
        env.COVDBG_OUTPUT = paths.configuredOutputPath;
        server.env = env;
        server.cwd = vscode.Uri.file(paths.workingDirectory);

        // A covdbg with different tool schemas should prompt the editor to refresh them.
        server.version = await getCovdbgVersion(resolved.path);

        output.log(`covdbg: MCP server resolved to ${resolved.path} (${resolved.source})`);
        return server;
    }
}
