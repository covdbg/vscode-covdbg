const BUILTIN_DISCOVERY_EXCLUDE_GLOB = '**/{.git,node_modules,.vscode,assets}/**';

export function buildExecutableDiscoveryExcludePattern(
    userExcludePattern: string,
): string {
    const trimmedUserPattern = userExcludePattern.trim();
    if (!trimmedUserPattern) {
        return BUILTIN_DISCOVERY_EXCLUDE_GLOB;
    }

    return `{${BUILTIN_DISCOVERY_EXCLUDE_GLOB},${trimmedUserPattern}}`;
}
