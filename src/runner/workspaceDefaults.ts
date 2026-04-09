import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getWorkspaceFoldersInPreferenceOrder,
    readRunnerSettings,
    resolvePathFromWorkspace,
} from './settings';

export interface CandidateExe {
    absolutePath: string;
    label: string;
    score: number;
    workspaceFolder: vscode.WorkspaceFolder;
}

export async function selectCoverageTargetExecutable(
    interactive: boolean,
    workspaceRoot?: string,
): Promise<CandidateExe | undefined> {
    const preferredFolders = getWorkspaceFoldersInPreferenceOrder();
    if (preferredFolders.length === 0) {
        return undefined;
    }

    const candidates = await discoverExecutableCandidates(workspaceRoot);
    if (candidates.length === 0) {
        if (interactive) {
            vscode.window.showErrorMessage('covdbg: No matching binary found in workspace. Adjust covdbg.runner.binaryDiscoveryPattern.');
        }
        return undefined;
    }

    let selected = candidates[0];
    if (interactive && candidates.length > 1) {
        const quickPickItems = candidates.slice(0, 30).map(candidate => ({
            label: candidate.label,
            description: `${candidate.workspaceFolder.name}: ${path.relative(candidate.workspaceFolder.uri.fsPath, candidate.absolutePath)}`,
            detail: candidate.absolutePath,
            absolutePath: candidate.absolutePath,
        }));
        const chosen = await vscode.window.showQuickPick(quickPickItems, {
            title: 'covdbg: Select C++ test executable',
            placeHolder: 'Choose the executable to run under coverage',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!chosen) {
            return undefined;
        }
        selected = candidates.find(c => c.absolutePath === chosen.absolutePath) ?? selected;
    }

    return selected;
}

export async function resolveOrSelectTargetExecutable(
    requestedTarget: string | undefined,
    workspaceRoot: string,
    interactive: boolean
): Promise<string | undefined> {
    if (requestedTarget) {
        const resolvedRequested = resolvePathFromWorkspace(requestedTarget, workspaceRoot);
        if (await isFile(resolvedRequested)) {
            return resolvedRequested;
        }
        if (!interactive) {
            return undefined;
        }
    }

    const picked = await selectCoverageTargetExecutable(interactive, workspaceRoot);
    return picked?.absolutePath;
}

export async function resolveEffectiveConfigPath(
    configuredConfigPath: string,
    targetExecutablePath: string,
    workspaceRoot: string
): Promise<string | undefined> {
    const explicit = configuredConfigPath.trim();
    if (explicit) {
        const explicitResolved = resolvePathFromWorkspace(explicit, workspaceRoot);
        if (await isFile(explicitResolved)) {
            return explicitResolved;
        }
        return undefined;
    }

    const nearest = await findNearestCovdbgYaml(path.dirname(targetExecutablePath), workspaceRoot);
    if (nearest) {
        return nearest;
    }
    return undefined;
}

export async function discoverExecutableCandidates(
    workspaceRoot?: string,
): Promise<CandidateExe[]> {
    const workspaceFolder = workspaceRoot
        ? vscode.workspace.workspaceFolders?.find(
            (folder) => folder.uri.fsPath === workspaceRoot,
        )
        : undefined;
    const folders = workspaceFolder
        ? [workspaceFolder]
        : getWorkspaceFoldersInPreferenceOrder();
    const candidates: CandidateExe[] = [];

    for (const folder of folders) {
        const settings = readRunnerSettings(folder.uri);
        const pattern = settings.binaryDiscoveryPattern;
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, pattern),
            '**/{.git,node_modules,.vscode,assets}/**',
            500,
        );
        for (const uri of matches) {
            if (!(await isDiscoveredExecutable(uri.fsPath))) {
                continue;
            }
            const score = scoreExecutable(uri.fsPath.toLowerCase());
            candidates.push({
                absolutePath: uri.fsPath,
                label: score >= 90 ? `$(beaker) ${path.basename(uri.fsPath)}` : `$(file-binary) ${path.basename(uri.fsPath)}`,
                score,
                workspaceFolder: folder,
            });
        }
    }
    return candidates.sort((a, b) => b.score - a.score || a.absolutePath.localeCompare(b.absolutePath));
}

export async function listDiscoveredExecutablePaths(workspaceRoot?: string): Promise<string[]> {
    const candidates = workspaceRoot
        ? await discoverExecutableCandidates(workspaceRoot)
        : await discoverExecutableCandidates();
    return candidates.map(c => c.absolutePath);
}

function scoreExecutable(p: string): number {
    let score = 0;
    if (p.includes('\\build\\') || p.includes('/build/')) { score += 20; }
    if (p.includes('\\out\\') || p.includes('/out/')) { score += 15; }
    if (p.includes('test')) { score += 40; }
    if (p.includes('gtest')) { score += 30; }
    if (p.endsWith('tests.exe')) { score += 25; }
    if (p.includes('\\debug\\') || p.includes('/debug/')) { score -= 5; }
    return score;
}

async function findNearestCovdbgYaml(startDir: string, workspaceRoot: string): Promise<string | undefined> {
    let current = path.resolve(startDir);
    const root = path.resolve(workspaceRoot);
    while (true) {
        const candidate = path.join(current, '.covdbg.yaml');
        if (await isFile(candidate)) {
            return candidate;
        }
        if (current === root) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current || !parent.startsWith(root)) {
            break;
        }
        current = parent;
    }
    return undefined;
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile();
    } catch {
        return false;
    }
}

async function isDiscoveredExecutable(filePath: string): Promise<boolean> {
    if (path.extname(filePath).toLowerCase() !== '.exe') {
        return false;
    }

    if (path.basename(filePath).toLowerCase() === 'covdbg.exe') {
        return false;
    }

    return isFile(filePath);
}

