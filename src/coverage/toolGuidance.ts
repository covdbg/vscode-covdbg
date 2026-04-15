export function buildNoCoverageLoadedGuidance(): string[] {
    return [
        "No coverage database is loaded yet. Build the real test executable or executables you want to validate, then call covdbg_run with those executable paths. Do not invent an aggregate executable name such as all_tests.",
        "The extension will generate and load the workspace coverage result automatically, including the merged batch result when multiple executables are run. After that, call covdbg_files to inspect which source files are still uncovered, then call covdbg_code with only that file path.",
    ];
}

export function buildUncoveredCodeLlmGuidance(): string[] {
    return [
        "After making a fix, rebuild the real test executable or executables that exercise that code, then call covdbg_run with those executable paths. The extension will refresh the workspace coverage result for you.",
        "After coverage is refreshed, call covdbg_code again with this file path. The extension will use the currently loaded workspace coverage result automatically, including the merged batch result when applicable.",
    ];
}

export function buildExploreUncoveredFilesLlmGuidance(): string[] {
    return [
        "This result comes from the active loaded coverage database: it lists the currently uncovered source files and their coverage summaries. Call covdbg_code with one of these file paths to inspect the exact uncovered segments. You only need to pass the source file path; the extension will use the currently loaded workspace coverage result automatically.",
        "If you need fresh coverage, rebuild the real test executable or executables that cover the change, then call covdbg_run with those executable paths. The extension will load the merged workspace result automatically when multiple executables are run.",
    ];
}

export function buildExploreEnvironmentLlmGuidance(): string[] {
    return [
        "Use the discovered executable paths from this result when calling covdbg_run. Do not invent synthetic test binary names.",
        "Use covdbg_files only after a coverage database is loaded. That tool reads uncovered files from the active workspace coverage result, not from workspace discovery metadata.",
        "Use covdbg_code only after choosing a source file from covdbg_files.",
    ];
}

export function buildNoActiveCoverageExploreGuidance(): string[] {
    return [
        "No coverage database is loaded yet. Build the real test executable or executables you want to validate, then call covdbg_run with those executable paths.",
        "When coverage is loaded, call covdbg_files to choose a source file based on what is still uncovered, then call covdbg_code with only that file path.",
    ];
}

export function buildCancelledRunCoverageGuidance(): string[] {
    return [
        "After rebuilding the real test executable or executables you want to validate, call covdbg_run again with those executable paths. Do not invent an aggregate executable name such as all_tests.",
        "When coverage is loaded, call covdbg_files to choose a file from the active workspace coverage result, then call covdbg_code with only that file path.",
    ];
}

export function buildRunCoverageLlmGuidance(options: {
    coverageLoaded: boolean;
    mergePerformed: boolean;
    mergedInputCount: number;
}): string[] {
    if (!options.coverageLoaded) {
        return [
            "Coverage was not loaded. Build or fix the real test executable or executables you want to validate, then call covdbg_run again with those executable paths. Do not invent an aggregate executable such as all_tests.",
            "After the rerun succeeds, the extension will load the workspace coverage result automatically, including the merged batch result when multiple executables are run. Then call covdbg_files to see which files are still uncovered and call covdbg_code with only that file path.",
        ];
    }

    const activeCoverageMessage = options.mergePerformed
        ? `Coverage is now loaded from the merged workspace result built from ${options.mergedInputCount} successful test executable run(s).`
        : "Coverage is now loaded in the active workspace result.";

    return [
        `${activeCoverageMessage} Next call covdbg_files to identify candidate source files from the active workspace coverage result. You do not need to pass any .covdb path; the extension already loaded the correct result for you.`,
        "After choosing a file, call covdbg_code with only that file path to inspect uncovered segments from the currently loaded workspace coverage result.",
        "If you make another fix, rebuild the real test executable or executables that exercise that code and call covdbg_run again. The extension will refresh and merge the workspace coverage result automatically when needed.",
    ];
}
