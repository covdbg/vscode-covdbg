import test from "node:test";
import assert from "node:assert/strict";
import { emptyCoverageSummary } from "../coverage/coverageSummary";
import { runTestWithCoverageWorkflow } from "../coverage/runTestWithCoverageWorkflow";

test("runTestWithCoverageWorkflow batches executables and uses final merged result", async () => {
    const executionCalls: Array<{
        executablePath: string;
        outputPathOverride?: string;
    }> = [];
    const result = await runTestWithCoverageWorkflow(["build\\suite1.exe", "build\\suite2.exe"], {
        resolveExecutablePath: (inputPath) => `D:\\repo\\${inputPath}`,
        fileExists: async () => true,
        buildBatchIntermediateOutputPath: (resolvedExecutablePath) =>
            resolvedExecutablePath.replace(/\.exe$/i, ".covdb"),
        executeCoverageRun: async (resolvedExecutablePath, outputPathOverride) => {
            executionCalls.push({
                executablePath: resolvedExecutablePath,
                outputPathOverride,
            });
            return {
                success: true,
                outputPath: outputPathOverride,
                coverageLoaded: true,
                coverageSummary: {
                    linesTotal: 10,
                    linesCovered: 7,
                    linesUncovered: 3,
                    coveragePercent: 70,
                },
            };
        },
        finalizeBatchCoverageOutputs: async (successfulOutputPaths, generatedOutputPaths) => {
            assert.deepEqual(successfulOutputPaths, [
                "D:\\repo\\build\\suite1.covdb",
                "D:\\repo\\build\\suite2.covdb",
            ]);
            assert.deepEqual(generatedOutputPaths, successfulOutputPaths);
            return {
                success: true,
                coverageLoaded: true,
                finalizedOutputPath: "D:\\repo\\.covdbg\\coverage.covdb",
                mergePerformed: true,
                mergedInputCount: 2,
                coverageSummary: {
                    linesTotal: 20,
                    linesCovered: 16,
                    linesUncovered: 4,
                    coveragePercent: 80,
                },
                lastRunOutputPaths: [...generatedOutputPaths, "D:\\repo\\.covdbg\\coverage.covdb"],
            };
        },
        dedupePaths: (paths) => [...new Set(paths)],
    });

    assert.deepEqual(executionCalls, [
        {
            executablePath: "D:\\repo\\build\\suite1.exe",
            outputPathOverride: "D:\\repo\\build\\suite1.covdb",
        },
        {
            executablePath: "D:\\repo\\build\\suite2.exe",
            outputPathOverride: "D:\\repo\\build\\suite2.covdb",
        },
    ]);
    assert.equal(result.toolResult.success, true);
    assert.equal(result.toolResult.mergePerformed, true);
    assert.equal(result.toolResult.mergedInputCount, 2);
    assert.equal(result.toolResult.finalizedOutputPath, "D:\\repo\\.covdbg\\coverage.covdb");
    assert.equal(result.toolResult.coverageSummary?.coveragePercent, 80);
    assert.deepEqual(result.lastRunOutputPaths, [
        "D:\\repo\\build\\suite1.covdb",
        "D:\\repo\\build\\suite2.covdb",
        "D:\\repo\\.covdbg\\coverage.covdb",
    ]);
});

test("runTestWithCoverageWorkflow reports missing executables without running coverage", async () => {
    let executeCalls = 0;
    const result = await runTestWithCoverageWorkflow(["missing.exe", ""], {
        resolveExecutablePath: (inputPath) => (inputPath ? `D:\\repo\\${inputPath}` : undefined),
        fileExists: async () => false,
        buildBatchIntermediateOutputPath: () => undefined,
        executeCoverageRun: async () => {
            executeCalls++;
            return {
                success: true,
                coverageLoaded: false,
            };
        },
        finalizeBatchCoverageOutputs: async () => ({
            success: false,
            coverageLoaded: false,
            mergePerformed: false,
            mergedInputCount: 0,
            lastRunOutputPaths: [],
        }),
        dedupePaths: (paths) => paths,
    });

    assert.equal(executeCalls, 0);
    assert.equal(result.toolResult.success, false);
    assert.equal(result.toolResult.completedCount, 0);
    assert.deepEqual(
        result.toolResult.results.map((entry) => entry.message),
        ["Executable not found: D:\\repo\\missing.exe", "No executable path provided."],
    );
    assert.deepEqual(result.lastRunOutputPaths, []);
    assert.deepEqual(result.toolResult.coverageSummary, emptyCoverageSummary());
});

test("runTestWithCoverageWorkflow keeps single executable output without finalization", async () => {
    const executionCalls: Array<{
        executablePath: string;
        outputPathOverride?: string;
    }> = [];
    let finalizeCalls = 0;
    const result = await runTestWithCoverageWorkflow(["build\\suite.exe"], {
        resolveExecutablePath: (inputPath) => `D:\\repo\\${inputPath}`,
        fileExists: async () => true,
        buildBatchIntermediateOutputPath: (resolvedExecutablePath) =>
            resolvedExecutablePath.replace(/\.exe$/i, ".covdb"),
        executeCoverageRun: async (resolvedExecutablePath, outputPathOverride) => {
            executionCalls.push({
                executablePath: resolvedExecutablePath,
                outputPathOverride,
            });
            return {
                success: true,
                outputPath: "D:\\repo\\build\\suite.covdb",
                coverageLoaded: true,
                coverageSummary: {
                    linesTotal: 10,
                    linesCovered: 7,
                    linesUncovered: 3,
                    coveragePercent: 70,
                },
            };
        },
        finalizeBatchCoverageOutputs: async () => {
            finalizeCalls++;
            return {
                success: false,
                coverageLoaded: false,
                mergePerformed: false,
                mergedInputCount: 0,
                lastRunOutputPaths: [],
            };
        },
        dedupePaths: (paths) => [...new Set(paths)],
    });

    assert.deepEqual(executionCalls, [
        {
            executablePath: "D:\\repo\\build\\suite.exe",
            outputPathOverride: undefined,
        },
    ]);
    assert.equal(finalizeCalls, 0);
    assert.equal(result.toolResult.success, true);
    assert.equal(result.toolResult.mergePerformed, false);
    assert.equal(result.toolResult.mergedInputCount, 1);
    assert.equal(result.toolResult.finalizedOutputPath, "D:\\repo\\build\\suite.covdb");
    assert.deepEqual(result.lastRunOutputPaths, ["D:\\repo\\build\\suite.covdb"]);
    assert.equal(result.toolResult.coverageSummary?.coveragePercent, 70);
});

test("runTestWithCoverageWorkflow reports batch finalization failures", async () => {
    const result = await runTestWithCoverageWorkflow(["build\\suite.exe", "build\\suite2.exe"], {
        resolveExecutablePath: (inputPath) => `D:\\repo\\${inputPath}`,
        fileExists: async () => true,
        buildBatchIntermediateOutputPath: (resolvedExecutablePath) =>
            resolvedExecutablePath.replace(/\.exe$/i, ".covdb"),
        executeCoverageRun: async (_resolvedExecutablePath, outputPathOverride) => ({
            success: true,
            outputPath: outputPathOverride,
            coverageLoaded: false,
        }),
        finalizeBatchCoverageOutputs: async () => ({
            success: false,
            coverageLoaded: false,
            mergePerformed: false,
            mergedInputCount: 2,
            lastRunOutputPaths: [],
        }),
        dedupePaths: (paths) => paths,
    });

    assert.equal(result.toolResult.success, false);
});
