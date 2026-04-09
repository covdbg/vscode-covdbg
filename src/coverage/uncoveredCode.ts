import { FileCoverage } from "./covdbParser";

export type UncoveredCodeResult = {
    file: string;
    coverage: {
        linesTotal: number;
        linesCovered: number;
        linesUncovered: number;
        coveragePercent: number;
    };
    uncoveredSegments: UncoveredSegment[];
    llmGuidance: string[];
    truncation?: UncoveredCodeTruncation;
};

export type UncoveredSegment = {
    startLine: number;
    endLine: number;
    code: string;
    reason?: string;
    contextBefore?: string;
    contextAfter?: string;
    truncated?: boolean;
};

export type UncoveredCodeTruncation = {
    totalSegmentCount: number;
    returnedSegmentCount: number;
    omittedSegmentCount: number;
};

type LineRange = {
    startLine: number;
    endLine: number;
};

const DEFAULT_CONTEXT_LINE_COUNT = 3;
const DEFAULT_MAX_SEGMENT_LINES = 20;
const DEFAULT_MAX_RETURNED_SEGMENTS = 25;
const DEFAULT_MAX_CODE_CHARS = 1200;
const DEFAULT_MAX_CONTEXT_CHARS = 400;

export function emptyUncoveredCodeResult(file: string): UncoveredCodeResult {
    return {
        file,
        coverage: {
            linesTotal: 0,
            linesCovered: 0,
            linesUncovered: 0,
            coveragePercent: 0,
        },
        uncoveredSegments: [],
        llmGuidance: buildLlmGuidance(),
    };
}

export function groupLineNumbersIntoRanges(
    lineNumbers: number[],
    maxSegmentLines = DEFAULT_MAX_SEGMENT_LINES,
): LineRange[] {
    if (lineNumbers.length === 0) {
        return [];
    }

    const sortedUnique = [...new Set(lineNumbers)]
        .filter((lineNumber) => Number.isInteger(lineNumber) && lineNumber > 0)
        .sort((left, right) => left - right);

    if (sortedUnique.length === 0) {
        return [];
    }

    const contiguousRanges: LineRange[] = [];
    let rangeStart = sortedUnique[0];
    let previous = sortedUnique[0];

    for (let index = 1; index < sortedUnique.length; index++) {
        const current = sortedUnique[index];
        if (current === previous + 1) {
            previous = current;
            continue;
        }

        contiguousRanges.push({ startLine: rangeStart, endLine: previous });
        rangeStart = current;
        previous = current;
    }

    contiguousRanges.push({ startLine: rangeStart, endLine: previous });

    const chunkedRanges: LineRange[] = [];
    for (const range of contiguousRanges) {
        let chunkStart = range.startLine;
        while (chunkStart <= range.endLine) {
            const chunkEnd = Math.min(
                chunkStart + maxSegmentLines - 1,
                range.endLine,
            );
            chunkedRanges.push({
                startLine: chunkStart,
                endLine: chunkEnd,
            });
            chunkStart = chunkEnd + 1;
        }
    }

    return chunkedRanges;
}

export function buildUncoveredCodeResult(
    file: string,
    documentText: string,
    coverage?: FileCoverage,
): UncoveredCodeResult {
    if (!coverage) {
        return emptyUncoveredCodeResult(file);
    }

    const documentLines = documentText.split(/\r?\n/);
    const uncoveredLines = [...coverage.lines.values()]
        .filter((lineCoverage) => !lineCoverage.isCovered)
        .map((lineCoverage) => lineCoverage.lineNumber);

    const ranges = groupLineNumbersIntoRanges(uncoveredLines);
    const uncoveredSegments = ranges
        .slice(0, DEFAULT_MAX_RETURNED_SEGMENTS)
        .map((range) => buildUncoveredSegment(documentLines, range));

    const omittedSegmentCount = Math.max(
        0,
        ranges.length - uncoveredSegments.length,
    );

    return {
        file,
        coverage: {
            linesTotal: coverage.totalLines,
            linesCovered: coverage.coveredLines,
            linesUncovered: Math.max(0, coverage.totalLines - coverage.coveredLines),
            coveragePercent: roundCoveragePercent(coverage.coveragePercent),
        },
        uncoveredSegments,
        llmGuidance: buildLlmGuidance(),
        truncation:
            omittedSegmentCount > 0
                ? {
                    totalSegmentCount: ranges.length,
                    returnedSegmentCount: uncoveredSegments.length,
                    omittedSegmentCount,
                }
                : undefined,
    };
}

function buildUncoveredSegment(
    documentLines: string[],
    range: LineRange,
): UncoveredSegment {
    const contextBefore = truncateSnippet(
        sliceLines(
        documentLines,
        Math.max(1, range.startLine - DEFAULT_CONTEXT_LINE_COUNT),
        range.startLine - 1,
        ),
        DEFAULT_MAX_CONTEXT_CHARS,
    );
    const contextAfter = truncateSnippet(
        sliceLines(
        documentLines,
        range.endLine + 1,
        Math.min(documentLines.length, range.endLine + DEFAULT_CONTEXT_LINE_COUNT),
        ),
        DEFAULT_MAX_CONTEXT_CHARS,
    );
    const code = truncateSnippet(
        sliceLines(documentLines, range.startLine, range.endLine),
        DEFAULT_MAX_CODE_CHARS,
    );
    const truncated = Boolean(
        code.truncated || contextBefore.truncated || contextAfter.truncated,
    );

    return {
        startLine: range.startLine,
        endLine: range.endLine,
        code: code.text,
        reason: inferReason(documentLines, range.startLine, range.endLine),
        contextBefore: contextBefore.text || undefined,
        contextAfter: contextAfter.text || undefined,
        ...(truncated ? { truncated: true } : {}),
    };
}

function buildLlmGuidance(): string[] {
    return [
        "After making a fix and rebuilding the target binary, call the runTestWithCoverage_covdbg tool with the relevant executable path to backtest the change.",
        "After the coverage run completes, call the getUncoveredCode_covdbg tool again for this file to inspect the updated uncovered segments.",
    ];
}

function inferReason(
    documentLines: string[],
    startLine: number,
    endLine: number,
): string | undefined {
    const windowStart = Math.max(1, startLine - DEFAULT_CONTEXT_LINE_COUNT);
    const windowEnd = Math.min(documentLines.length, endLine + 1);
    const snippet = sliceLines(documentLines, windowStart, windowEnd);

    if (/\bcatch\b/.test(snippet)) {
        return "exception_path";
    }
    if (/\belse\s+if\s*\(|\bif\s*\(|\bswitch\s*\(|\bcase\b/.test(snippet)) {
        return "branch_not_taken";
    }
    return undefined;
}

function sliceLines(
    documentLines: string[],
    startLine: number,
    endLine: number,
): string {
    if (endLine < startLine || startLine <= 0 || endLine <= 0) {
        return "";
    }

    const selectedLines = documentLines.slice(startLine - 1, endLine);
    return trimBoundaryWhitespace(selectedLines).join("\n");
}

function truncateSnippet(
    text: string,
    maxChars: number,
): { text: string; truncated: boolean } {
    if (text.length <= maxChars) {
        return { text, truncated: false };
    }

    const marker = "\n... [truncated]";
    const keep = Math.max(0, maxChars - marker.length);
    return {
        text: text.slice(0, keep).trimEnd() + marker,
        truncated: true,
    };
}

function roundCoveragePercent(value: number): number {
    return Math.round(value * 100) / 100;
}

function trimBoundaryWhitespace(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;

    while (start < end && lines[start].trim().length === 0) {
        start++;
    }
    while (end > start && lines[end - 1].trim().length === 0) {
        end--;
    }

    return lines.slice(start, end);
}