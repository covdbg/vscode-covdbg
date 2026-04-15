import * as path from "path";
import * as vscode from "vscode";
import { ensureArrayOfStrings } from "./runnerArgs";
import { deriveCoverageBatchOutputPath } from "./outputPaths";
import { RunnerResolvedPaths, RunnerSettings } from "./runnerTypes";

const DEFAULT_BINARY_DISCOVERY_PATTERN =
    "{build,Build,BUILD,out,Out,OUT}/**/*{test,Test,TEST}*";
const DEFAULT_BINARY_DISCOVERY_EXCLUDE_PATTERN = "";

export function readRunnerSettings(
    scope?: vscode.ConfigurationScope,
): RunnerSettings {
    const config = vscode.workspace.getConfiguration("covdbg", scope);
    const env = config.get<Record<string, string>>("runner.env", {});
    return {
        executablePath: config.get<string>("executablePath", "").trim(),
        portableCachePath: config.get<string>("portableCachePath", "").trim(),
        binaryDiscoveryPattern:
            config
                .get<string>(
                    "runner.binaryDiscoveryPattern",
                    DEFAULT_BINARY_DISCOVERY_PATTERN,
                )
                .trim() || DEFAULT_BINARY_DISCOVERY_PATTERN,
        binaryDiscoveryExcludePattern: config
            .get<string>(
                "runner.binaryDiscoveryExcludePattern",
                DEFAULT_BINARY_DISCOVERY_EXCLUDE_PATTERN,
            )
            .trim(),
        licenseServerUrl: config
            .get<string>("runner.licenseServerUrl", "")
            .trim(),
        targetArgs: ensureArrayOfStrings(config.get("runner.targetArgs", [])),
        analyzeInputs: ensureArrayOfStrings(
            config.get("runner.analyzeInputs", []),
        ),
        analyzeInputsByTarget: sanitizeAnalyzeInputsByTarget(
            config.get("runner.analyzeInputsByTarget", {}),
        ),
        configPath: config.get<string>("runner.configPath", "").trim(),
        outputPath: config
            .get<string>("runner.outputPath", ".covdbg/coverage.covdb")
            .trim(),
        appDataPath:
            config.get<string>("runner.appDataPath", ".covdbg").trim() ||
            ".covdbg",
        workingDirectory: config
            .get<string>("runner.workingDirectory", "")
            .trim(),
        env: sanitizeEnv(env),
    };
}

export function getWorkspaceRoot(): string | undefined {
    return getPreferredWorkspaceFolder()?.uri.fsPath;
}

export function getPreferredWorkspaceFolder(
    filePath?: string,
): vscode.WorkspaceFolder | undefined {
    if (filePath && path.isAbsolute(filePath)) {
        const exactFolder = vscode.workspace.getWorkspaceFolder(
            vscode.Uri.file(filePath),
        );
        if (exactFolder) {
            return exactFolder;
        }
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
        if (activeFolder) {
            return activeFolder;
        }
    }

    return vscode.workspace.workspaceFolders?.[0];
}

export function getWorkspaceFoldersInPreferenceOrder(): vscode.WorkspaceFolder[] {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const preferred = getPreferredWorkspaceFolder();
    if (!preferred) {
        return [...workspaceFolders];
    }

    return [
        preferred,
        ...workspaceFolders.filter((folder) => folder.uri.toString() !== preferred.uri.toString()),
    ];
}

export function resolvePathFromWorkspace(
    inputPath: string,
    workspaceRoot: string,
): string {
    if (path.isAbsolute(inputPath)) {
        return path.normalize(inputPath);
    }
    return path.normalize(path.resolve(workspaceRoot, inputPath));
}

export function resolveRunnerPaths(
    settings: RunnerSettings,
    workspaceRoot: string,
): RunnerResolvedPaths {
    const configuredOutputPath = resolvePathFromWorkspace(
        settings.outputPath || ".covdbg/coverage.covdb",
        workspaceRoot,
    );
    const appDataPath = resolvePathFromWorkspace(
        settings.appDataPath || ".covdbg",
        workspaceRoot,
    );
    const workingDirectory = settings.workingDirectory
        ? resolvePathFromWorkspace(settings.workingDirectory, workspaceRoot)
        : workspaceRoot;

    const configPath = settings.configPath
        ? resolvePathFromWorkspace(settings.configPath, workspaceRoot)
        : undefined;

    return {
        workspaceRoot,
        configPath,
        configuredOutputPath,
        outputPath: configuredOutputPath,
        appDataPath,
        workingDirectory,
    };
}

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env || {})) {
        if (!key || typeof value !== "string") {
            continue;
        }
        result[key] = value;
    }
    return result;
}

function sanitizeAnalyzeInputsByTarget(
    value: unknown,
): Record<string, string[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const result: Record<string, string[]> = {};
    for (const [pattern, inputs] of Object.entries(value)) {
        if (!pattern.trim()) {
            continue;
        }
        result[pattern.trim()] = ensureArrayOfStrings(inputs);
    }
    return result;
}
