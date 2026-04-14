import * as path from "path";

export function deriveCoverageBatchOutputPath(
    configuredOutputPath: string,
    targetExecutablePath: string,
): string {
    const parsedOutputPath = path.parse(path.normalize(configuredOutputPath));
    const parsedTargetPath = path.parse(path.normalize(targetExecutablePath));
    const targetBaseName = sanitizeOutputSegment(parsedTargetPath.name) || "coverage";
    return path.join(parsedOutputPath.dir, `${targetBaseName}.covdb`);
}

export function dedupeNormalizedPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const filePath of paths) {
        const normalizedPath = path.normalize(filePath);
        const key = normalizedPath.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(normalizedPath);
    }
    return deduped;
}

function sanitizeOutputSegment(value: string): string {
    return value
        .trim()
        .replace(/[<>:"/\\|?*]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
