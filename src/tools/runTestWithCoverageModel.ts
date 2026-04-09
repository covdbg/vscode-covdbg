import type { CoverageSummary } from "../coverage/coverageSummary";

export const RUN_TEST_WITH_COVERAGE_TOOL_NAME = "runTestWithCoverage_covdbg";

export type RunTestWithCoverageToolInput = {
    executablePaths?: string[];
    executablePath?: string;
};

export type RunTestWithCoverageExecutableResult = {
    success: boolean;
    executablePath: string;
    outputPath?: string;
    coverageLoaded: boolean;
    coverageSummary?: CoverageSummary;
    message: string;
};

export type RunTestWithCoverageToolResult = {
    success: boolean;
    requestedCount: number;
    completedCount: number;
    coverageLoaded: boolean;
    coverageSummary?: CoverageSummary;
    finalizedOutputPath?: string;
    mergePerformed: boolean;
    mergedInputCount: number;
    results: RunTestWithCoverageExecutableResult[];
    message: string;
    llmGuidance: string[];
};

export function normalizeExecutablePathsInput(
    input: RunTestWithCoverageToolInput,
): string[] {
    const normalizedPaths = input.executablePaths
        ?.map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0);

    if (normalizedPaths && normalizedPaths.length > 0) {
        return normalizedPaths;
    }

    const singularPath = input.executablePath?.trim();
    return singularPath ? [singularPath] : [];
}