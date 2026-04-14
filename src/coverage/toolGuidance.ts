export function buildNoCoverageLoadedGuidance(): string[] {
    return [
        "No coverage database is loaded yet. Build the real test executable or executables you want to validate, then call runTestWithCoverage_covdbg with those executable paths. Do not invent an aggregate executable name such as all_tests.",
        "The extension will generate and load the workspace coverage result automatically, including the merged batch result when multiple executables are run. After that, call exploreUncoveredFiles_covdbg to choose a file, then call getUncoveredCode_covdbg with only that file path.",
    ];
}

export function buildUncoveredCodeLlmGuidance(): string[] {
    return [
        "After making a fix, rebuild the real test executable or executables that exercise that code, then call runTestWithCoverage_covdbg with those executable paths. The extension will refresh the workspace coverage result for you.",
        "After coverage is refreshed, call getUncoveredCode_covdbg again with this file path. The extension will use the currently loaded workspace coverage result automatically, including the merged batch result when applicable.",
    ];
}

export function buildExploreUncoveredFilesLlmGuidance(): string[] {
    return [
        "Call getUncoveredCode_covdbg with one of these file paths to inspect the exact uncovered segments. You only need to pass the source file path; the extension will use the currently loaded workspace coverage result automatically.",
        "If you need fresh coverage, rebuild the real test executable or executables that cover the change, then call runTestWithCoverage_covdbg with those executable paths. The extension will load the merged workspace result automatically when multiple executables are run.",
    ];
}

export function buildNoActiveCoverageExploreGuidance(): string[] {
    return [
        "No coverage database is loaded yet. Build the real test executable or executables you want to validate, then call runTestWithCoverage_covdbg with those executable paths.",
        "When coverage is loaded, call exploreUncoveredFiles_covdbg to choose a source file and then call getUncoveredCode_covdbg with only that file path.",
    ];
}

export function buildCancelledRunCoverageGuidance(): string[] {
    return [
        "After rebuilding the real test executable or executables you want to validate, call runTestWithCoverage_covdbg again with those executable paths. Do not invent an aggregate executable name such as all_tests.",
        "When coverage is loaded, call exploreUncoveredFiles_covdbg to choose a file from the active workspace coverage result, then call getUncoveredCode_covdbg with only that file path.",
    ];
}

export function buildRunCoverageLlmGuidance(options: {
    coverageLoaded: boolean;
    mergePerformed: boolean;
    mergedInputCount: number;
}): string[] {
    if (!options.coverageLoaded) {
        return [
            "Coverage was not loaded. Build or fix the real test executable or executables you want to validate, then call runTestWithCoverage_covdbg again with those executable paths. Do not invent an aggregate executable such as all_tests.",
            "After the rerun succeeds, the extension will load the workspace coverage result automatically, including the merged batch result when multiple executables are run. Then call exploreUncoveredFiles_covdbg to choose a file and getUncoveredCode_covdbg with only that file path.",
        ];
    }

    const activeCoverageMessage = options.mergePerformed
        ? `Coverage is now loaded from the merged workspace result built from ${options.mergedInputCount} successful test executable run(s).`
        : "Coverage is now loaded in the active workspace result.";

    return [
        `${activeCoverageMessage} Next call exploreUncoveredFiles_covdbg to identify candidate source files from the active workspace coverage result. You do not need to pass any .covdb path; the extension already loaded the correct result for you.`,
        "After choosing a file, call getUncoveredCode_covdbg with only that file path to inspect uncovered segments from the currently loaded workspace coverage result.",
        "If you make another fix, rebuild the real test executable or executables that exercise that code and call runTestWithCoverage_covdbg again. The extension will refresh and merge the workspace coverage result automatically when needed.",
    ];
}
