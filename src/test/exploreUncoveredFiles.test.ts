import test from "node:test";
import assert from "node:assert/strict";
import { CovdbFileSummary } from "../coverage/covdbParser";
import { buildExploreUncoveredFilesResult } from "../coverage/exploreUncoveredFiles";

test("buildExploreUncoveredFilesResult sorts by uncovered lines and coverage", () => {
    const fileIndex = new Map<string, CovdbFileSummary>([
        [
            "D:\\repo\\src\\alpha.cpp",
            {
                filePath: "D:\\repo\\src\\alpha.cpp",
                totalLines: 100,
                coveredLines: 25,
                coveragePercent: 25,
            },
        ],
        [
            "D:\\repo\\src\\beta.cpp",
            {
                filePath: "D:\\repo\\src\\beta.cpp",
                totalLines: 60,
                coveredLines: 0,
                coveragePercent: 0,
            },
        ],
        [
            "D:\\repo\\src\\gamma.cpp",
            {
                filePath: "D:\\repo\\src\\gamma.cpp",
                totalLines: 100,
                coveredLines: 100,
                coveragePercent: 100,
            },
        ],
    ]);

    const result = buildExploreUncoveredFilesResult(fileIndex, {
        activeCovdbPath: "D:\\repo\\.covdbg\\coverage.covdb",
        workspaceRelativePathForFile: (filePath) =>
            filePath.replace("D:\\repo\\", ""),
    });

    assert.equal(result.coverageSummary.linesTotal, 260);
    assert.equal(result.coverageSummary.linesCovered, 125);
    assert.equal(result.coverageSummary.linesUncovered, 135);
    assert.equal(result.coverageSummary.coveragePercent, 48.08);
    assert.equal(result.coverageSummary.fileCount, 3);
    assert.equal(result.totalIndexedFiles, 3);
    assert.equal(result.returnedFileCount, 2);
    assert.equal(result.files[0].fileName, "alpha.cpp");
    assert.equal(result.files[0].linesUncovered, 75);
    assert.equal(result.files[0].workspaceRelativePath, "src\\alpha.cpp");
    assert.equal(result.files[1].fileName, "beta.cpp");
    assert.equal(result.files[1].linesUncovered, 60);
});

test("buildExploreUncoveredFilesResult applies limit and coverage filter", () => {
    const fileIndex = new Map<string, CovdbFileSummary>([
        [
            "D:\\repo\\src\\alpha.cpp",
            {
                filePath: "D:\\repo\\src\\alpha.cpp",
                totalLines: 10,
                coveredLines: 4,
                coveragePercent: 40,
            },
        ],
        [
            "D:\\repo\\src\\beta.cpp",
            {
                filePath: "D:\\repo\\src\\beta.cpp",
                totalLines: 10,
                coveredLines: 3,
                coveragePercent: 30,
            },
        ],
        [
            "D:\\repo\\src\\gamma.cpp",
            {
                filePath: "D:\\repo\\src\\gamma.cpp",
                totalLines: 10,
                coveredLines: 8,
                coveragePercent: 80,
            },
        ],
    ]);

    const result = buildExploreUncoveredFilesResult(fileIndex, {
        limit: 1,
        maxCoveragePercent: 50,
    });

    assert.equal(result.returnedFileCount, 1);
    assert.equal(result.files[0].fileName, "beta.cpp");
});