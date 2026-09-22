import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { spawn } from "child_process";
import * as output from "../views/outputChannel";
import { getUnsupportedReason } from "../mcp/preflight";
import { RunnerSettings, RuntimeSource, RuntimeState } from "./runnerTypes";
import {
    portableArchiveStampMatches,
    readPortableArchiveStamp,
    writePortableArchiveStamp,
} from "./portableCacheState";
import { resolvePathFromWorkspace } from "./settings";
import { getKnownInstallPaths } from "./installPaths";
import { MIN_COVDBG_VERSION, meetsMinimumVersion, probeCovdbgVersion } from "./version";

const COVDBG_EXE = "covdbg.exe";
const BUNDLED_PORTABLE_ZIP = "covdbg-portable.zip";
const BUNDLED_PORTABLE_STATE = "bundled-state.json";

export interface RuntimeCandidate {
    source: RuntimeSource;
    /** Finds the exe. Called only once every earlier candidate has been ruled out. */
    locate: () => Promise<string | undefined>;
}

const pendingResolutions = new Map<string, Promise<RuntimeState>>();

/**
 * The covdbg to run, or why there is none.
 *
 * Calls that overlap share one resolution, so two first runs never expand the bundled archive
 * into the same folder at the same time.
 */
export function resolveCovdbgRuntime(
    context: vscode.ExtensionContext,
    settings: RunnerSettings,
    workspaceRoot: string,
): Promise<RuntimeState> {
    const reason = getUnsupportedReason({
        platform: process.platform,
        isTrusted: vscode.workspace.isTrusted,
        remoteName: vscode.env.remoteName,
    });
    if (reason) {
        return Promise.resolve({ kind: "unsupported", reason });
    }

    const key = [workspaceRoot, settings.executablePath, settings.portableCachePath].join("|");
    let pending = pendingResolutions.get(key);
    if (!pending) {
        pending = pickRuntime(
            getRuntimeCandidates(context, settings, workspaceRoot),
            probeCovdbgVersion,
        ).finally(() => pendingResolutions.delete(key));
        pendingResolutions.set(key, pending);
    }
    return pending;
}

/** Where covdbg is looked for, best first: the setting, PATH, installs, then the bundled copy. */
export function getRuntimeCandidates(
    context: vscode.ExtensionContext,
    settings: RunnerSettings,
    workspaceRoot: string,
): RuntimeCandidate[] {
    const candidates: RuntimeCandidate[] = [];
    if (settings.executablePath) {
        const configured = resolvePathFromWorkspace(settings.executablePath, workspaceRoot);
        candidates.push({
            source: "setting",
            locate: async () => {
                if (await fileExists(configured)) {
                    return configured;
                }
                output.logError(`Configured covdbg.executablePath not found: ${configured}`);
                return undefined;
            },
        });
    }
    candidates.push({ source: "path", locate: findExecutableOnPath });
    for (const installPath of getKnownInstallPaths()) {
        candidates.push({
            source: "install",
            locate: async () => ((await fileExists(installPath)) ? installPath : undefined),
        });
    }
    candidates.push({ source: "bundled", locate: () => resolveBundledPortable(context, settings) });
    candidates.push({
        source: "cache",
        locate: () => findCachedPortableExecutable(getPortableRoot(context, settings)),
    });
    return candidates;
}

/**
 * The first candidate whose `--version` is at least {@link MIN_COVDBG_VERSION}.
 *
 * An older one is skipped, except when covdbg.executablePath names it: the user chose that file,
 * so it is reported rather than quietly replaced by another.
 */
export async function pickRuntime(
    candidates: RuntimeCandidate[],
    probe: (executablePath: string) => Promise<string | undefined>,
): Promise<RuntimeState> {
    let firstTooOld: RuntimeState | undefined;
    for (const candidate of candidates) {
        const exePath = await candidate.locate();
        if (!exePath) {
            continue;
        }
        const version = await probe(exePath);
        if (version && meetsMinimumVersion(version)) {
            return { kind: "ok", path: exePath, version, source: candidate.source };
        }
        const fromSetting = candidate.source === "setting";
        output.log(
            `covdbg runtime: ${exePath} reports ${version ?? "no version"}; ` +
                `${MIN_COVDBG_VERSION} or newer is needed`,
        );
        if (fromSetting) {
            return { kind: "tooOld", path: exePath, version, fromSetting };
        }
        firstTooOld ??= { kind: "tooOld", path: exePath, version, fromSetting };
    }
    return firstTooOld ?? { kind: "missing" };
}

/** Why there is no covdbg to run, as one sentence for an error message or the log. */
export function describeRuntimeProblem(state: Exclude<RuntimeState, { kind: "ok" }>): string {
    switch (state.kind) {
        case "missing":
            return `covdbg ${MIN_COVDBG_VERSION} or newer was not found. Install covdbg, or set covdbg.executablePath.`;
        case "tooOld": {
            const found = state.version ? `covdbg ${state.version}` : state.path;
            return state.fromSetting
                ? `covdbg.executablePath points at ${found}, but covdbg ${MIN_COVDBG_VERSION} or newer is needed.`
                : `Found ${found}, but covdbg ${MIN_COVDBG_VERSION} or newer is needed. Install a newer covdbg, or set covdbg.executablePath.`;
        }
        case "unsupported":
            return {
                platform: "covdbg runs only on Windows.",
                remote: "covdbg runs only in a local window, not a remote one.",
                untrusted: "covdbg runs executables only in a trusted workspace.",
            }[state.reason];
    }
}

async function findExecutableOnPath(): Promise<string | undefined> {
    const pathEnv = process.env.PATH;
    if (!pathEnv) {
        return undefined;
    }
    for (const segment of pathEnv.split(path.delimiter)) {
        const dir = segment.trim();
        if (!dir) {
            continue;
        }
        const fullPath = path.join(dir, COVDBG_EXE);
        if (await fileExists(fullPath)) {
            return fullPath;
        }
    }
    return undefined;
}

function getPortableRoot(context: vscode.ExtensionContext, settings: RunnerSettings): string {
    if (settings.portableCachePath) {
        return settings.portableCachePath;
    }
    return path.join(context.globalStorageUri.fsPath, "portable");
}

async function findCachedPortableExecutable(portableRoot: string): Promise<string | undefined> {
    if (!(await fileExists(portableRoot))) {
        return undefined;
    }
    return await findFileRecursively(portableRoot, COVDBG_EXE, 4);
}

async function resolveBundledPortable(
    context: vscode.ExtensionContext,
    settings: RunnerSettings,
): Promise<string | undefined> {
    const bundledRoot = path.join(context.extensionUri.fsPath, "assets", "portable");
    const bundledExe = await findFileRecursively(bundledRoot, COVDBG_EXE, 4);
    if (bundledExe) {
        return bundledExe;
    }

    const bundledZipPath = path.join(bundledRoot, BUNDLED_PORTABLE_ZIP);
    if (!(await fileExists(bundledZipPath))) {
        return undefined;
    }

    const bundledZipStats = await fs.stat(bundledZipPath);
    const bundledZipStamp = {
        size: bundledZipStats.size,
        mtimeMs: bundledZipStats.mtimeMs,
    };
    const cacheRoot = getPortableRoot(context, settings);
    const extractPath = path.join(cacheRoot, "bundled");
    const statePath = path.join(extractPath, BUNDLED_PORTABLE_STATE);
    const cachedBundledExe = await findFileRecursively(extractPath, COVDBG_EXE, 5);
    const cachedStamp = await readPortableArchiveStamp(statePath);
    if (cachedBundledExe && portableArchiveStampMatches(bundledZipStamp, cachedStamp)) {
        return cachedBundledExe;
    }
    await fs.mkdir(extractPath, { recursive: true });
    try {
        await fs.rm(extractPath, { recursive: true, force: true });
        await fs.mkdir(extractPath, { recursive: true });
        output.log(`Extracting bundled portable from ${bundledZipPath}`);
        await extractZipWindows(bundledZipPath, extractPath);
        const extractedExe = await findFileRecursively(extractPath, COVDBG_EXE, 5);
        if (!extractedExe) {
            output.logError("Bundled portable zip does not contain covdbg.exe");
            return undefined;
        }
        await writePortableArchiveStamp(statePath, bundledZipStamp);
        return extractedExe;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.logError(`Failed to extract bundled portable: ${message}`);
        return undefined;
    }
}

function extractZipWindows(zipPath: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = [
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
        ];
        const child = spawn("powershell.exe", script, { stdio: "pipe" });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Expand-Archive failed (exit ${code}): ${stderr.trim()}`));
            }
        });
    });
}

async function findFileRecursively(
    root: string,
    fileName: string,
    maxDepth: number,
): Promise<string | undefined> {
    async function walk(current: string, depth: number): Promise<string | undefined> {
        if (depth > maxDepth) {
            return undefined;
        }
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
                return full;
            }
            if (entry.isDirectory()) {
                const nested = await walk(full, depth + 1);
                if (nested) {
                    return nested;
                }
            }
        }
        return undefined;
    }
    try {
        return await walk(root, 0);
    } catch {
        return undefined;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() || stats.isDirectory();
    } catch {
        return false;
    }
}
