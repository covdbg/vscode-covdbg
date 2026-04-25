import test from "node:test";
import assert from "node:assert/strict";
import { CoverageWorkspaceSession, type CoverageRepository } from "../coverage/coverageSession";
import type { CovdbFileCoverageResult, CovdbIndexResult } from "../coverage/covdbParser";
import { buildNoCoverageLoadedGuidance } from "../coverage/toolGuidance";

test("CoverageWorkspaceSession loads index, filters files, and clears caches", async () => {
    const repository: CoverageRepository = {
        loadIndex: async (): Promise<CovdbIndexResult> => ({
            schemaVersion: 1,
            files: new Map([
                [
                    "D:\\repo\\src\\alpha.cpp",
                    {
                        filePath: "D:\\repo\\src\\alpha.cpp",
                        totalLines: 20,
                        coveredLines: 10,
                        coveragePercent: 50,
                    },
                ],
                [
                    "D:\\external\\sdk.cpp",
                    {
                        filePath: "D:\\external\\sdk.cpp",
                        totalLines: 10,
                        coveredLines: 10,
                        coveragePercent: 100,
                    },
                ],
            ]),
        }),
        loadFileCoverage: async (): Promise<CovdbFileCoverageResult> => ({}),
    };

    const session = new CoverageWorkspaceSession(repository);
    const result = await session.loadIndex("D:\\repo\\coverage.covdb", {
        mtime: 42,
        filterFileIndex: (fileIndex) =>
            new Map([...fileIndex].filter(([filePath]) => filePath.startsWith("D:\\repo\\"))),
    });

    assert.equal(result.error, undefined);
    assert.equal(result.loadedFileCount, 1);
    assert.equal(result.totalFileCount, 2);
    assert.equal(result.activeCovdbPath, "D:\\repo\\coverage.covdb");
    assert.equal(result.activeCovdbMtime, 42);
    assert.deepEqual([...result.fileIndex.keys()], ["D:\\repo\\src\\alpha.cpp"]);

    const snapshot = session.snapshot();
    assert.equal(snapshot.cachedCoverageFileCount, 0);
    assert.equal(snapshot.staleCoverageFileCount, 0);
    assert.equal(snapshot.fileIndex.size, 1);
});

test("CoverageWorkspaceSession caches file coverage and reloads stale entries", async () => {
    let loadFileCoverageCallCount = 0;

    const repository: CoverageRepository = {
        loadIndex: async (): Promise<CovdbIndexResult> => ({
            schemaVersion: 1,
            files: new Map(),
        }),
        loadFileCoverage: async (): Promise<CovdbFileCoverageResult> => {
            loadFileCoverageCallCount++;
            return {
                coverage: {
                    sourceFile: "D:\\repo\\src\\alpha.cpp",
                    lines: new Map([
                        [1, { lineNumber: 1, executionCount: 1, isCovered: true }],
                        [2, { lineNumber: 2, executionCount: 0, isCovered: false }],
                    ]),
                    totalLines: 2,
                    coveredLines: 1,
                    coveragePercent: 50,
                },
            };
        },
    };

    const session = new CoverageWorkspaceSession(repository);
    session.replaceIndex("D:\\repo\\coverage.covdb", new Map());

    const first = await session.getOrLoadFileCoverage("D:\\repo\\src\\alpha.cpp");
    const second = await session.getOrLoadFileCoverage("D:\\repo\\src\\alpha.cpp");
    session.markCoverageStale("D:\\repo\\src\\alpha.cpp");
    const third = await session.getOrLoadFileCoverage("D:\\repo\\src\\alpha.cpp");

    assert.equal(first?.coveredLines, 1);
    assert.equal(second?.coveredLines, 1);
    assert.equal(third?.coveredLines, 1);
    assert.equal(loadFileCoverageCallCount, 2);
});

test("CoverageWorkspaceSession builds uncovered-code results from loaded coverage", async () => {
    const repository: CoverageRepository = {
        loadIndex: async (): Promise<CovdbIndexResult> => ({
            schemaVersion: 1,
            files: new Map(),
        }),
        loadFileCoverage: async (): Promise<CovdbFileCoverageResult> => ({
            coverage: {
                sourceFile: "D:\\repo\\src\\alpha.cpp",
                lines: new Map([
                    [1, { lineNumber: 1, executionCount: 1, isCovered: true }],
                    [2, { lineNumber: 2, executionCount: 0, isCovered: false }],
                ]),
                totalLines: 2,
                coveredLines: 1,
                coveragePercent: 50,
            },
        }),
    };

    const session = new CoverageWorkspaceSession(repository);
    session.replaceIndex("D:\\repo\\coverage.covdb", new Map());
    const result = await session.buildUncoveredCode(
        "D:\\repo\\src\\alpha.cpp",
        "D:\\repo\\src\\alpha.cpp",
        ["int main() {", "    return 0;", "}"].join("\n"),
        {
            metadata: { workspaceRelativePath: "src/alpha.cpp" },
        },
    );

    assert.equal(result.coverage.linesUncovered, 1);
    assert.equal(result.fileMetadata.workspaceRelativePath, "src/alpha.cpp");
    assert.equal(result.uncoveredSegments.length, 1);
    assert.equal(result.uncoveredSegments[0].startLine, 2);
});

test("CoverageWorkspaceSession returns no-coverage guidance when no coverage database is active", async () => {
    const repository: CoverageRepository = {
        loadIndex: async (): Promise<CovdbIndexResult> => ({
            schemaVersion: 1,
            files: new Map(),
        }),
        loadFileCoverage: async (): Promise<CovdbFileCoverageResult> => ({}),
    };

    const session = new CoverageWorkspaceSession(repository);
    const result = await session.buildUncoveredCode(
        "D:\\repo\\src\\alpha.cpp",
        "D:\\repo\\src\\alpha.cpp",
        "return 0;",
        {
            noCoverageGuidance: buildNoCoverageLoadedGuidance(),
        },
    );

    assert.equal(result.coverage.linesTotal, 0);
    assert.equal(result.uncoveredSegments.length, 0);
    assert.deepEqual(result.llmGuidance, buildNoCoverageLoadedGuidance());
});
