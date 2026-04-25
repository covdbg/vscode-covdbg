import * as path from "path";

export function findBestCoverageKey(
    editorPath: string,
    keys: Iterable<string>,
    workspaceRoot?: string,
): string | undefined {
    const normalizedEditor = normalizeComparablePath(editorPath);
    const keyEntries = [...keys].map((key) => ({
        key,
        normalized: normalizeComparablePath(key),
    }));
    const pathLib = getPathLibrary(
        editorPath,
        workspaceRoot,
        ...keyEntries.map((entry) => entry.key),
    );

    const exact = keyEntries.find((entry) => entry.normalized === normalizedEditor);
    if (exact) {
        return exact.key;
    }

    if (workspaceRoot) {
        const relativeEditor = pathLib.relative(workspaceRoot, editorPath);
        if (!relativeEditor.startsWith("..") && !pathLib.isAbsolute(relativeEditor)) {
            const normalizedRelative = normalizeComparablePath(relativeEditor);
            const relativeMatches = keyEntries.filter(
                (entry) =>
                    entry.normalized === normalizedRelative ||
                    entry.normalized.endsWith(`/${normalizedRelative}`),
            );
            if (relativeMatches.length === 1) {
                return relativeMatches[0].key;
            }
        }
    }

    const suffixMatches = keyEntries.filter(
        (entry) =>
            normalizedEditor.endsWith(entry.normalized) ||
            entry.normalized.endsWith(normalizedEditor),
    );
    if (suffixMatches.length === 1) {
        return suffixMatches[0].key;
    }

    return undefined;
}

function normalizeComparablePath(inputPath: string): string {
    return path.normalize(inputPath).replace(/\\/g, "/").toLowerCase();
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
