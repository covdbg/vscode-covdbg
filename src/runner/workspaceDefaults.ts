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

export async function ensureTargetExecutableSetting(interactive: boolean): Promise<{ targetExecutable: string; workspaceFolder: vscode.WorkspaceFolder } | undefined> {
    const preferredFolders = getWorkspaceFoldersInPreferenceOrder();
    for (const folder of preferredFolders) {
        const config = vscode.workspace.getConfiguration('covdbg', folder.uri);
        const configured = config.get<string>('runner.targetExecutable', '').trim();
        if (configured) {
            return { targetExecutable: configured, workspaceFolder: folder };
        }
    }

    if (preferredFolders.length === 0) {
        return undefined;
    }

    const candidates = await discoverExecutableCandidates();
    if (candidates.length === 0) {
        if (interactive) {
            vscode.window.showErrorMessage('covdbg: No matching binary found in workspace. Adjust covdbg.runner.binaryDiscoveryPattern or set covdbg.runner.targetExecutable.');
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

    const relative = path.relative(selected.workspaceFolder.uri.fsPath, selected.absolutePath);
    const config = vscode.workspace.getConfiguration('covdbg', selected.workspaceFolder.uri);
    await config.update('runner.targetExecutable', relative, vscode.ConfigurationTarget.WorkspaceFolder);
    if (interactive) {
        vscode.window.showInformationMessage(`covdbg: Using runner target "${relative}".`);
    }
    return { targetExecutable: relative, workspaceFolder: selected.workspaceFolder };
}

export async function resolveOrSelectTargetExecutable(
    configuredTarget: string,
    workspaceRoot: string,
    interactive: boolean
): Promise<string | undefined> {
    const resolvedConfigured = resolvePathFromWorkspace(configuredTarget, workspaceRoot);
    if (await isFile(resolvedConfigured)) {
        return resolvedConfigured;
    }

    const basename = path.basename(resolvedConfigured);
    const multiConfigCandidates = [
        path.join(path.dirname(resolvedConfigured), 'Debug', basename),
        path.join(path.dirname(resolvedConfigured), 'Release', basename),
        path.join(path.dirname(resolvedConfigured), 'RelWithDebInfo', basename),
        path.join(path.dirname(resolvedConfigured), 'MinSizeRel', basename),
    ];
    for (const candidate of multiConfigCandidates) {
        if (await isFile(candidate)) {
            await persistTargetSetting(candidate, workspaceRoot, interactive);
            return candidate;
        }
    }

    const allCandidates = await discoverExecutableCandidates(workspaceRoot);
    const basenameMatches = allCandidates.filter(candidate =>
        path.basename(candidate.absolutePath).toLowerCase() === basename.toLowerCase()
    );
    const shortlist = basenameMatches.length > 0 ? basenameMatches : allCandidates;
    if (shortlist.length === 0) {
        return undefined;
    }

    if (!interactive) {
        await persistTargetSetting(shortlist[0].absolutePath, workspaceRoot, false);
        return shortlist[0].absolutePath;
    }

    const picked = await vscode.window.showQuickPick(
        shortlist.slice(0, 40).map(candidate => ({
            label: candidate.label,
            description: path.relative(workspaceRoot, candidate.absolutePath),
            detail: candidate.absolutePath,
            absolutePath: candidate.absolutePath,
        })),
        {
            title: 'covdbg: Target executable not found',
            placeHolder: `Configured target missing (${configuredTarget}). Select an existing executable.`,
            matchOnDescription: true,
            matchOnDetail: true,
        }
    );
    if (!picked) {
        return undefined;
    }

    await persistTargetSetting(picked.absolutePath, workspaceRoot, true);
    return picked.absolutePath;
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

async function persistTargetSetting(absolutePath: string, workspaceRoot: string, showInfo: boolean): Promise<void> {
    const relative = path.relative(workspaceRoot, absolutePath);
    const workspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.fsPath === workspaceRoot);
    const config = vscode.workspace.getConfiguration('covdbg', workspaceFolder?.uri);
    await config.update('runner.targetExecutable', relative, workspaceFolder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
    if (showInfo) {
        vscode.window.showInformationMessage(`covdbg: Using runner target "${relative}".`);
    }
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

