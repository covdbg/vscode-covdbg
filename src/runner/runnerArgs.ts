import { RunnerResolvedPaths } from './runnerTypes';

export function buildCovdbgArguments(paths: RunnerResolvedPaths, targetArgs: string[]): string[] {
    const args: string[] = [];
    args.push('--appdata', paths.appDataPath);
    if (paths.configPath) {
        args.push('--config', paths.configPath);
    }
    args.push('--output', paths.outputPath);
    args.push(paths.targetExecutablePath, ...targetArgs);
    return args;
}

export function ensureArrayOfStrings(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean);
}

