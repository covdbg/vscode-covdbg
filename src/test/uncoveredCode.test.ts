import test from "node:test";
import assert from "node:assert/strict";
import { FileCoverage } from "../coverage/covdbParser";
import {
    buildUncoveredCodeResult,
    groupLineNumbersIntoRanges,
} from "../coverage/uncoveredCode";

test("groupLineNumbersIntoRanges groups contiguous lines and chunks long regions", () => {
    const ranges = groupLineNumbersIntoRanges([
        3, 4, 5, 10, 11,
        20, 21, 22, 23, 24, 25,
    ], 3);

    assert.deepEqual(ranges, [
        { startLine: 3, endLine: 5 },
        { startLine: 10, endLine: 11 },
        { startLine: 20, endLine: 22 },
        { startLine: 23, endLine: 25 },
    ]);
});

test("buildUncoveredCodeResult returns grouped uncovered segments with context", () => {
    const coverage: FileCoverage = {
        sourceFile: "D:\\Code\\covdbg\\vscode-covdbg\\src\\sample.cpp",
        lines: new Map([
            [1, { lineNumber: 1, executionCount: 3, isCovered: true }],
            [2, { lineNumber: 2, executionCount: 0, isCovered: false }],
            [3, { lineNumber: 3, executionCount: 0, isCovered: false }],
            [4, { lineNumber: 4, executionCount: 1, isCovered: true }],
            [5, { lineNumber: 5, executionCount: 0, isCovered: false }],
        ]),
        totalLines: 5,
        coveredLines: 2,
        coveragePercent: 40.126,
    };
    const documentText = [
        "void sample() {",
        "    if (flag) {",
        "        doWork();",
        "    }",
        "    catchHandler();",
        "}",
    ].join("\n");

    const result = buildUncoveredCodeResult(
        coverage.sourceFile,
        documentText,
        coverage,
    );

    assert.equal(result.coverage.linesTotal, 5);
    assert.equal(result.coverage.linesCovered, 2);
    assert.equal(result.coverage.linesUncovered, 3);
    assert.equal(result.coverage.coveragePercent, 40.13);
    assert.equal(result.uncoveredSegments.length, 2);
    assert.equal(result.llmGuidance.length, 2);
    assert.equal(result.truncation, undefined);
    assert.deepEqual(result.uncoveredSegments[0], {
        startLine: 2,
        endLine: 3,
        code: [
            "    if (flag) {",
            "        doWork();",
        ].join("\n"),
        reason: "branch_not_taken",
        contextBefore: "void sample() {",
        contextAfter: [
            "    }",
            "    catchHandler();",
            "}",
        ].join("\n"),
    });
    assert.equal(result.uncoveredSegments[1].startLine, 5);
    assert.equal(result.uncoveredSegments[1].endLine, 5);
    assert.equal(result.uncoveredSegments[1].code, "    catchHandler();");
});

test("buildUncoveredCodeResult truncates oversized snippets and reports omitted segments", () => {
    const coverage: FileCoverage = {
        sourceFile: "D:\\Code\\covdbg\\vscode-covdbg\\src\\large.cpp",
        lines: new Map(),
        totalLines: 60,
        coveredLines: 0,
        coveragePercent: 0,
    };

    for (let lineNumber = 1; lineNumber <= 60; lineNumber += 2) {
        coverage.lines.set(lineNumber, {
            lineNumber,
            executionCount: 0,
            isCovered: false,
        });
    }

    const documentText = new Array(60)
        .fill(0)
        .map((_, index) => `line ${index + 1} ${"x".repeat(1400)}`)
        .join("\n");

    const result = buildUncoveredCodeResult(
        coverage.sourceFile,
        documentText,
        coverage,
    );

    assert.ok(result.uncoveredSegments.length > 0);
    assert.equal(result.truncation?.totalSegmentCount, 30);
    assert.equal(result.truncation?.returnedSegmentCount, 25);
    assert.equal(result.truncation?.omittedSegmentCount, 5);
    assert.match(result.uncoveredSegments[0].code, /\[truncated\]/);
    assert.equal(result.uncoveredSegments[0].truncated, true);
});