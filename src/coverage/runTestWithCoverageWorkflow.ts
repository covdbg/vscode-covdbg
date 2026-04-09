import {
    emptyCoverageSummary,
    type CoverageSummary,
} from "./coverageSummary";
import { buildRunCoverageLlmGuidance } from "./toolGuidance";
import {
    type RunTestWithCoverageExecutableResult,
    type RunTestWithCoverageToolResult,
} from "../tools/runTestWithCoverageModel";

export type CoverageRunExecutionResult = {
    success: boolean;
    outputPath?: string;
    coverageLoaded: boolean;
    coverageSummary?: CoverageSummary;
};

export type CoverageBatchFinalizationResult = {
    coverageLoaded: boolean;
    finalizedOutputPath?: string;
    mergePerformed: boolean;
    mergedInputCount: number;
    coverageSummary?: CoverageSummary;
    lastRunOutputPaths: string[];
};

type RunTestWithCoverageWorkflowDependencies = {
    resolveExecutablePath: (inputPath: string) => string | undefined;
    fileExists: (filePath: string) => Promise<boolean>;
    buildBatchIntermediateOutputPath: (
        resolvedExecutablePath: string,
    ) => string | undefined;
    executeCoverageRun: (
        resolvedExecutablePath: string,
        outputPathOverride?: string,
    ) => Promise<CoverageRunExecutionResult>;
    finalizeBatchCoverageOutputs: (
        successfulOutputPaths: string[],
        generatedOutputPaths: string[],
    ) => Promise<CoverageBatchFinalizationResult>;
    dedupePaths: (paths: string[]) => string[];
};

export type RunTestWithCoverageWorkflowResult = {
    toolResult: RunTestWithCoverageToolResult;
    lastRunOutputPaths: string[];
};

export async function runTestWithCoverageWorkflow(
    executablePaths: string[],
    dependencies: RunTestWithCoverageWorkflowDependencies,
): Promise<RunTestWithCoverageWorkflowResult> {
    const results: RunTestWithCoverageExecutableResult[] = [];
    let anyCoverageLoaded = false;
    const successfulOutputPaths: string[] = [];
    const generatedOutputPaths: string[] = [];
    const batchMode = executablePaths.length > 1;
    let finalizedOutputPath: string | undefined;
    let mergePerformed = false;
    let mergedInputCount = 0;
    let lastRunOutputPaths: string[] = [];

    for (const executablePath of executablePaths) {
        const resolvedExecutablePath = dependencies.resolveExecutablePath(
            executablePath,
        );
        if (!resolvedExecutablePath) {
            results.push({
                success: false,
                executablePath,
                coverageLoaded: false,
                coverageSummary: emptyCoverageSummary(),
                message: "No executable path provided.",
            });
            continue;
        }

        if (!(await dependencies.fileExists(resolvedExecutablePath))) {
            results.push({
                success: false,
                executablePath: resolvedExecutablePath,
                coverageLoaded: false,
                coverageSummary: emptyCoverageSummary(),
                message: `Executable not found: ${resolvedExecutablePath}`,
            });
            continue;
        }

        const runResult = await dependencies.executeCoverageRun(
            resolvedExecutablePath,
            batchMode
                ? dependencies.buildBatchIntermediateOutputPath(
                    resolvedExecutablePath,
                )
                : undefined,
        );
        anyCoverageLoaded = anyCoverageLoaded || runResult.coverageLoaded;
        if (runResult.outputPath) {
            generatedOutputPaths.push(runResult.outputPath);
        }
        if (runResult.success && runResult.outputPath) {
            successfulOutputPaths.push(runResult.outputPath);
        }
        results.push({
            success: runResult.success,
            executablePath: resolvedExecutablePath,
            outputPath: runResult.outputPath,
            coverageLoaded: runResult.coverageLoaded,
            coverageSummary: runResult.coverageSummary,
            message: buildCoverageRunMessage(
                runResult.success,
                runResult.coverageLoaded,
            ),
        });
    }

    let finalCoverageSummary = findLatestCoverageSummary(results);
    if (batchMode) {
        const finalized = await dependencies.finalizeBatchCoverageOutputs(
            successfulOutputPaths,
            generatedOutputPaths,
        );
        anyCoverageLoaded = finalized.coverageLoaded;
        finalizedOutputPath = finalized.finalizedOutputPath;
        mergePerformed = finalized.mergePerformed;
        mergedInputCount = finalized.mergedInputCount;
        lastRunOutputPaths = finalized.lastRunOutputPaths;
        if (finalized.coverageSummary) {
            finalCoverageSummary = finalized.coverageSummary;
        }
    } else {
        lastRunOutputPaths = dependencies.dedupePaths(generatedOutputPaths);
        finalizedOutputPath = generatedOutputPaths[0];
        mergedInputCount = successfulOutputPaths.length;
    }

    const success = results.length > 0 && results.every((result) => result.success);
    return {
        toolResult: {
            success,
            requestedCount: executablePaths.length,
            completedCount: results.filter((result) => result.success).length,
            coverageLoaded: anyCoverageLoaded,
            coverageSummary: finalCoverageSummary,
            finalizedOutputPath,
            mergePerformed,
            mergedInputCount,
            results,
            message:
                results.length === 0
                    ? "No executable paths were provided."
                    : success
                        ? `Coverage completed for ${results.length} executable${results.length === 1 ? "" : "s"}.`
                        : `Coverage completed with ${results.filter((result) => !result.success).length} failed executable${results.filter((result) => !result.success).length === 1 ? "" : "s"}.`,
            llmGuidance: buildRunCoverageLlmGuidance({
                coverageLoaded: anyCoverageLoaded,
                mergePerformed,
                mergedInputCount,
            }),
        },
        lastRunOutputPaths,
    };
}

function buildCoverageRunMessage(
    success: boolean,
    coverageLoaded: boolean,
): string {
    if (!success) {
        return "Coverage run failed.";
    }

    return coverageLoaded
        ? "Coverage run completed and coverage data was loaded."
        : "Coverage run completed, but no coverage database was loaded afterwards.";
}

function findLatestCoverageSummary(
    results: RunTestWithCoverageExecutableResult[],
): CoverageSummary | undefined {
    for (let index = results.length - 1; index >= 0; index--) {
        const summary = results[index].coverageSummary;
        if (summary) {
            return summary;
        }
    }

    return undefined;
}