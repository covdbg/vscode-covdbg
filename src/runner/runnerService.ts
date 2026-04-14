import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import * as vscode from "vscode";
import * as output from "../views/outputChannel";
import { buildCovdbgArguments } from "./runnerArgs";
import { LicenseStatusSnapshot, readLicenseStatus } from "./licenseStatus";
import { resolveCovdbgExecutable } from "./executableResolver";
import {
    COVDBG_EXIT_NO_FUNCTIONS_TO_TRACK,
    getCovdbgRunFailureMessage,
} from "./exitCodes";
import type { RunnerSettings } from "./runnerTypes";
import {
    getPreferredWorkspaceFolder,
    getWorkspaceRoot,
    readRunnerSettings,
    resolveRunnerPaths,
} from "./settings";
import {
    resolveEffectiveConfigPath,
    resolveOrSelectTargetExecutable,
} from "./workspaceDefaults";
import { getCovdbgVersion } from "./runtimeInfo";

export interface RunResult {
    success: boolean;
    outputPath?: string;
    configuredOutputPath?: string;
    targetExecutablePath?: string;
    licenseStatus?: LicenseStatusSnapshot;
}

export async function runCoverageForTarget(
    context: vscode.ExtensionContext,
    targetExecutablePath: string,
    outputPathOverride?: string,
    onStart?: () => void,
    onFinish?: (success: boolean) => void,
): Promise<RunResult> {
    return runCoverageInternal(
        context,
        {
            targetExecutableOverride: targetExecutablePath,
            outputPathOverride,
            interactiveTargetSelection: false,
            showProgress: false,
        },
        onStart,
        onFinish,
    );
}

interface RunOptions {
    targetExecutableOverride?: string;
    outputPathOverride?: string;
    workspaceFolderOverride?: vscode.WorkspaceFolder;
    interactiveTargetSelection: boolean;
    showProgress: boolean;
}

async function runCoverageInternal(
    context: vscode.ExtensionContext,
    options: RunOptions,
    onStart?: () => void,
    onFinish?: (success: boolean) => void,
): Promise<RunResult> {
    const trustErr = await ensurePreflight();
    if (trustErr) {
        vscode.window
            .showErrorMessage(trustErr.message, ...trustErr.actions)
            .then((action) => {
                if (action === "Manage Trust") {
                    void vscode.commands.executeCommand(
                        "workbench.trust.manage",
                    );
                } else if (action === "Open Settings") {
                    void vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "covdbg.runner",
                    );
                }
            });
        return { success: false };
    }

    const workspaceFolder =
        options.workspaceFolderOverride ??
        getPreferredWorkspaceFolder(options.targetExecutableOverride);
    const settings = readRunnerSettings(workspaceFolder?.uri);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showErrorMessage(
            "covdbg: Open a workspace folder before running coverage.",
        );
        return { success: false };
    }

    const effectiveTargetExecutablePath = await resolveOrSelectTargetExecutable(
        options.targetExecutableOverride,
        workspaceRoot,
        options.interactiveTargetSelection,
    );
    if (!effectiveTargetExecutablePath) {
        vscode.window.showErrorMessage(
            "covdbg: No runnable test executable found. Refresh test discovery or build a test binary first.",
        );
        return { success: false };
    }

    const paths = resolveRunnerPaths(settings, workspaceRoot);
    const outputPath = options.outputPathOverride
        ? path.normalize(options.outputPathOverride)
        : paths.outputPath;

    const explicitConfig = settings.configPath.trim();
    const effectiveConfigPath = await resolveEffectiveConfigPath(
        explicitConfig,
        effectiveTargetExecutablePath,
        workspaceRoot,
    );
    if (explicitConfig && !effectiveConfigPath) {
        vscode.window.showErrorMessage(
            `covdbg: Config file not found: ${paths.configPath ?? explicitConfig}`,
        );
        return { success: false };
    }
    if (!effectiveConfigPath) {
        output.log(
            "No .covdbg.yaml resolved explicitly; covdbg will use its built-in config discovery.",
        );
    }

    const resolvedExe = await resolveCovdbgExecutable(
        context,
        settings,
        workspaceRoot,
    );
    if (!resolvedExe) {
        vscode.window.showErrorMessage(
            "covdbg executable not found. Ensure bundled portable exists or configure covdbg.executablePath.",
        );
        return { success: false };
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.mkdir(paths.appDataPath, { recursive: true });
    output.show();
    const version = await getCovdbgVersion(resolvedExe.path);
    const versionInfo = version ? ` (${version})` : "";
    output.log(
        `Running coverage (${resolvedExe.source}): ${resolvedExe.path}${versionInfo}`,
    );

    const licenseRunConfig = buildLicenseRunConfig(settings);
    const args = buildCovdbgArguments(
        {
            ...paths,
            configPath: effectiveConfigPath,
            outputPath,
        },
        effectiveTargetExecutablePath,
        settings.targetArgs,
        licenseRunConfig.args,
    );
    const env = {
        ...process.env,
        ...licenseRunConfig.env,
    };

    onStart?.();
    const executeRun = () =>
        new Promise<boolean>((resolve) => {
            const child = spawn(resolvedExe.path, args, {
                cwd: paths.workingDirectory,
                env,
                windowsHide: true,
            });

            child.stdout.on("data", (chunk) =>
                output.log(String(chunk).trimEnd()),
            );
            child.stderr.on("data", (chunk) =>
                output.log(String(chunk).trimEnd()),
            );
            child.on("error", (error) => {
                output.logError(`Failed to start covdbg: ${error.message}`);
                resolve(false);
            });
            child.on("close", (code) => {
                const ok = code === 0;
                if (!ok) {
                    const failureMessage = getCovdbgRunFailureMessage(code);
                    output.logError(failureMessage);
                    if (code === COVDBG_EXIT_NO_FUNCTIONS_TO_TRACK) {
                        void vscode.window.showWarningMessage(
                            `covdbg: ${failureMessage}`,
                        );
                    }
                } else {
                    output.log(
                        `Coverage run finished. Output: ${outputPath}`,
                    );
                }
                resolve(ok);
            });
        });

    const success = options.showProgress
        ? await vscode.window.withProgress<boolean>(
            {
                location: vscode.ProgressLocation.Notification,
                title: "covdbg: Running coverage",
                cancellable: false,
            },
            async () => executeRun(),
        )
        : await executeRun();
    const licenseStatus = await readLicenseStatus(paths.appDataPath);
    onFinish?.(success);

    if (success) {
        return {
            success: true,
            outputPath,
            configuredOutputPath: paths.configuredOutputPath,
            targetExecutablePath: effectiveTargetExecutablePath,
            licenseStatus,
        };
    }
    return {
        success: false,
        outputPath,
        configuredOutputPath: paths.configuredOutputPath,
        targetExecutablePath: effectiveTargetExecutablePath,
        licenseStatus,
    };
}

export async function mergeCoverageFiles(
    context: vscode.ExtensionContext,
    inputPaths: string[],
    outputPath: string,
    workspaceFolder?: vscode.WorkspaceFolder,
): Promise<boolean> {
    const trustErr = await ensurePreflight();
    if (trustErr) {
        output.logError(`covdbg merge unavailable: ${trustErr.message}`);
        return false;
    }

    if (inputPaths.length === 0) {
        return false;
    }

    const workspaceRoot = workspaceFolder?.uri.fsPath ?? getWorkspaceRoot();
    if (!workspaceRoot) {
        output.logError("covdbg merge requires an open workspace folder.");
        return false;
    }

    const settings = readRunnerSettings(workspaceFolder?.uri);
    const resolvedExe = await resolveCovdbgExecutable(
        context,
        settings,
        workspaceRoot,
    );
    if (!resolvedExe) {
        output.logError("covdbg merge failed: covdbg executable not found.");
        return false;
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const args = [
        "merge",
        ...inputPaths.flatMap((inputPath) => ["--input", inputPath]),
        "--output",
        outputPath,
    ];

    output.log(`Merging ${inputPaths.length} coverage file(s) into ${outputPath}`);

    return new Promise<boolean>((resolve) => {
        const child = spawn(resolvedExe.path, args, {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                ...settings.env,
            },
            windowsHide: true,
        });

        child.stdout.on("data", (chunk) => output.log(String(chunk).trimEnd()));
        child.stderr.on("data", (chunk) => output.log(String(chunk).trimEnd()));
        child.on("error", (error) => {
            output.logError(`Failed to start covdbg merge: ${error.message}`);
            resolve(false);
        });
        child.on("close", (code) => {
            const ok = code === 0;
            if (!ok) {
                output.logError(`covdbg merge exited with code ${code}`);
            }
            resolve(ok);
        });
    });
}

interface LicenseRunConfig {
    args: string[];
    env: Record<string, string>;
}

function buildLicenseRunConfig(
    settings: Pick<RunnerSettings, "env" | "licenseServerUrl">,
): LicenseRunConfig {
    const env = { ...settings.env };

    if (settings.licenseServerUrl) {
        env.COVDBG_LICENSE_SERVER_URL = settings.licenseServerUrl;
    }

    const hasExplicitLicense = [
        env.COVDBG_LICENSE,
        env.COVDBG_LICENSE_FILE,
        env.COVDBG_FETCH_LICENSE,
    ].some((value) => typeof value === "string" && value.trim().length > 0);

    if (hasExplicitLicense) {
        return { args: [], env };
    }

    const args = ["--demo", "--plugin-name", "vscode"];

    const extension = vscode.extensions.getExtension("covdbg.covdbg");
    const extensionVersion = extension?.packageJSON?.version;
    if (
        typeof extensionVersion === "string" &&
        extensionVersion.trim().length > 0
    ) {
        args.push("--plugin-ver", extensionVersion.trim());
    }

    output.log("covdbg: Auto-requesting plugin demo license for VS Code run.");
    return { args, env };
}

interface PreflightError {
    message: string;
    actions: string[];
}

async function ensurePreflight(): Promise<PreflightError | undefined> {
    if (process.platform !== "win32") {
        return {
            message: "covdbg runner is supported only on Windows.",
            actions: [],
        };
    }
    if (!vscode.workspace.isTrusted) {
        return {
            message: "covdbg runner requires a trusted workspace.",
            actions: ["Manage Trust"],
        };
    }
    if (vscode.env.remoteName) {
        return {
            message: `covdbg runner requires local Windows VS Code. Current remote: ${vscode.env.remoteName}`,
            actions: [],
        };
    }
    return undefined;
}
