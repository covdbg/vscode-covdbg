/** Test executables under the usual CMake, MSBuild and CLion build folders. */
export const DEFAULT_BINARY_DISCOVERY_PATTERN =
    "{build,Build,out,Out,x64,cmake-build-*}/**/*{test,Test,TEST}*";
export const DEFAULT_BINARY_DISCOVERY_EXCLUDE_PATTERN =
    "**/{Release,RelWithDebInfo,cmake-build-release*,cmake-build-relwithdebinfo*}/**";
const BUILTIN_DISCOVERY_EXCLUDE_GLOB = "**/{.git,node_modules,.vscode,assets}/**";

export function buildExecutableDiscoveryExcludePattern(userExcludePattern: string): string {
    const trimmedUserPattern = userExcludePattern.trim();
    if (!trimmedUserPattern) {
        return BUILTIN_DISCOVERY_EXCLUDE_GLOB;
    }

    return `{${BUILTIN_DISCOVERY_EXCLUDE_GLOB},${trimmedUserPattern}}`;
}
