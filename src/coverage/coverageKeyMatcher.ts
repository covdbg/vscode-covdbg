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

    const exact = keyEntries.find((entry) => entry.normalized === normalizedEditor);
    if (exact) {
        return exact.key;
    }

    if (workspaceRoot) {
        const relativeEditor = path.relative(workspaceRoot, editorPath);
        if (!relativeEditor.startsWith("..") && !path.isAbsolute(relativeEditor)) {
            const normalizedRelative = normalizeComparablePath(relativeEditor);
            const relativeMatches = keyEntries.filter((entry) =>
                entry.normalized === normalizedRelative ||
                entry.normalized.endsWith(`/${normalizedRelative}`),
            );
            if (relativeMatches.length === 1) {
                return relativeMatches[0].key;
            }
        }
    }

    const suffixMatches = keyEntries.filter((entry) =>
        normalizedEditor.endsWith(entry.normalized) ||
        entry.normalized.endsWith(normalizedEditor),
    );
    if (suffixMatches.length === 1) {
        return suffixMatches[0].key;
    }

    return undefined;
}

function normalizeComparablePath(inputPath: string): string {
    return path
        .normalize(inputPath)
        .replace(/\\/g, "/")
        .toLowerCase();
}
