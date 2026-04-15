import * as path from "path";

export type AnalyzeInputSettings = {
    analyzeInputs: string[];
    analyzeInputsByTarget: Record<string, string[]>;
};

export function resolveAnalyzeInputsForTarget(
    settings: AnalyzeInputSettings,
    workspaceRoot: string,
    targetPath: string,
): string[] {
    const pathLib = getPathLibrary(workspaceRoot, targetPath, ...settings.analyzeInputs, ...Object.keys(settings.analyzeInputsByTarget));
    const absoluteTargetPath = resolvePathFromWorkspace(targetPath, workspaceRoot);
    const normalizedAbsolutePath = normalizePathForMatch(absoluteTargetPath);
    const relativeTargetPath = normalizePathForMatch(
        pathLib.relative(workspaceRoot, absoluteTargetPath),
    );
    const baseName = normalizePathForMatch(pathLib.basename(absoluteTargetPath));

    for (const [pattern, inputPaths] of Object.entries(
        settings.analyzeInputsByTarget,
    )) {
        if (
            matchesTargetPattern(pattern, normalizedAbsolutePath) ||
            matchesTargetPattern(pattern, relativeTargetPath) ||
            matchesTargetPattern(pattern, baseName)
        ) {
            return dedupeAnalyzeInputPaths(inputPaths, workspaceRoot);
        }
    }

    return dedupeAnalyzeInputPaths(settings.analyzeInputs, workspaceRoot);
}

export function resolvePathFromWorkspace(
    inputPath: string,
    workspaceRoot: string,
): string {
    const pathLib = getPathLibrary(inputPath, workspaceRoot);
    if (pathLib.isAbsolute(inputPath)) {
        return pathLib.normalize(inputPath);
    }
    return pathLib.normalize(pathLib.resolve(workspaceRoot, inputPath));
}

function dedupeAnalyzeInputPaths(
    inputPaths: string[],
    workspaceRoot: string,
): string[] {
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const inputPath of inputPaths) {
        const normalizedPath = resolvePathFromWorkspace(inputPath, workspaceRoot);
        const key = normalizePathForMatch(normalizedPath);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        resolved.push(normalizedPath);
    }
    return resolved;
}

function matchesTargetPattern(pattern: string, candidate: string): boolean {
    const normalizedPattern = normalizePathForMatch(pattern);
    if (!normalizedPattern) {
        return false;
    }

    const matcher = new RegExp(`^${globToRegex(normalizedPattern)}$`, "i");
    return matcher.test(candidate);
}

function normalizePathForMatch(value: string): string {
    return value.replace(/\\/g, "/").trim();
}

function globToRegex(pattern: string): string {
    let regex = "";
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        const nextChar = pattern[index + 1];
        if (char === "*") {
            if (nextChar === "*") {
                regex += ".*";
                index++;
            } else {
                regex += "[^/]*";
            }
            continue;
        }
        if (char === "?") {
            regex += "[^/]";
            continue;
        }
        regex += escapeRegexCharacter(char);
    }
    return regex;
}

function escapeRegexCharacter(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function getPathLibrary(
    ...filePaths: Array<string | undefined>
): typeof path.posix | typeof path.win32 {
    return filePaths.some(
        (filePath) => filePath && (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")),
    )
        ? path.win32
        : path.posix;
}
