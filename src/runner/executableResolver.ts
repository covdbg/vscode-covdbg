import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as output from '../views/outputChannel';
import { ResolvedExecutable, RunnerSettings } from './runnerTypes';
import { resolvePathFromWorkspace } from './settings';
import { getKnownInstallPaths } from './installPaths';

const COVDBG_EXE = 'covdbg.exe';
const BUNDLED_PORTABLE_ZIP = 'covdbg-portable.zip';

export async function resolveCovdbgExecutable(
    context: vscode.ExtensionContext,
    settings: RunnerSettings,
    workspaceRoot: string
): Promise<ResolvedExecutable | undefined> {
    if (settings.executablePath) {
        const resolved = resolvePathFromWorkspace(settings.executablePath, workspaceRoot);
        if (await fileExists(resolved)) {
            return { path: resolved, source: 'setting' };
        }
        output.logError(`Configured covdbg.executablePath not found: ${resolved}`);
    }

    const bundled = await resolveBundledPortable(context, settings);
    if (bundled) {
        return { path: bundled, source: 'bundled' };
    }

    const onPath = await findExecutableOnPath();
    if (onPath) {
        return { path: onPath, source: 'path' };
    }

    for (const candidate of getKnownInstallPaths()) {
        if (await fileExists(candidate)) {
            return { path: candidate, source: 'install' };
        }
    }

    const cached = await findCachedPortableExecutable(getPortableRoot(context, settings));
    if (cached) {
        return { path: cached, source: 'cache' };
    }
    return undefined;
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
    return path.join(context.globalStorageUri.fsPath, 'portable');
}

async function findCachedPortableExecutable(portableRoot: string): Promise<string | undefined> {
    if (!(await fileExists(portableRoot))) {
        return undefined;
    }
    return await findFileRecursively(portableRoot, COVDBG_EXE, 4);
}

async function resolveBundledPortable(
    context: vscode.ExtensionContext,
    settings: RunnerSettings
): Promise<string | undefined> {
    const bundledRoot = path.join(context.extensionUri.fsPath, 'assets', 'portable');
    const bundledExe = await findFileRecursively(bundledRoot, COVDBG_EXE, 4);
    if (bundledExe) {
        return bundledExe;
    }

    const bundledZipPath = path.join(bundledRoot, BUNDLED_PORTABLE_ZIP);
    if (!(await fileExists(bundledZipPath))) {
        return undefined;
    }

    const cacheRoot = getPortableRoot(context, settings);
    const extractPath = path.join(cacheRoot, 'bundled');
    const cachedBundledExe = await findFileRecursively(extractPath, COVDBG_EXE, 5);
    if (cachedBundledExe) {
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
            output.logError('Bundled portable zip does not contain covdbg.exe');
            return undefined;
        }
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
            '-NoLogo',
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
        ];
        const child = spawn('powershell.exe', script, { stdio: 'pipe' });
        let stderr = '';
        child.stderr.on('data', chunk => {
            stderr += String(chunk);
        });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Expand-Archive failed (exit ${code}): ${stderr.trim()}`));
            }
        });
    });
}

async function findFileRecursively(root: string, fileName: string, maxDepth: number): Promise<string | undefined> {
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

