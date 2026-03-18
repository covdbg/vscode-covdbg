import { spawn } from 'child_process';
import * as vscode from 'vscode';
import * as output from '../views/outputChannel';
import { resolveCovdbgExecutable } from './executableResolver';
import { getWorkspaceRoot, readRunnerSettings } from './settings';

const versionCache = new Map<string, string | undefined>();

export async function getCovdbgVersion(executablePath: string): Promise<string | undefined> {
    if (versionCache.has(executablePath)) {
        return versionCache.get(executablePath);
    }
    const version = await probeVersion(executablePath);
    versionCache.set(executablePath, version);
    return version;
}

export async function logCovdbgResolution(context: vscode.ExtensionContext): Promise<void> {
    try {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return;
        }
        const settings = readRunnerSettings();
        const resolved = await resolveCovdbgExecutable(context, settings, workspaceRoot);
        if (!resolved) {
            output.log('covdbg runtime: executable not resolved at activation');
            return;
        }
        const version = await getCovdbgVersion(resolved.path);
        const versionInfo = version ? ` (${version})` : '';
        output.log(`covdbg runtime: using ${resolved.source} executable ${resolved.path}${versionInfo}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.logError(`covdbg runtime probe failed: ${message}`);
    }
}

async function probeVersion(executablePath: string): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        const child = spawn(executablePath, ['--version'], { windowsHide: true });
        let outputBuffer = '';
        let settled = false;

        const finish = (value: string | undefined) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };

        const timeout = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            finish(undefined);
        }, 2000);

        child.stdout.on('data', chunk => {
            outputBuffer += String(chunk);
        });
        child.stderr.on('data', chunk => {
            outputBuffer += String(chunk);
        });
        child.on('error', () => {
            clearTimeout(timeout);
            finish(undefined);
        });
        child.on('close', () => {
            clearTimeout(timeout);
            const line = outputBuffer
                .split(/\r?\n/g)
                .map(s => s.trim())
                .find(Boolean);
            finish(line);
        });
    });
}

