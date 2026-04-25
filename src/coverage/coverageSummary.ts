import { CovdbFileSummary, FileCoverage } from "./covdbParser";

export type CoverageSummary = {
    linesTotal: number;
    linesCovered: number;
    linesUncovered: number;
    coveragePercent: number;
    fileCount?: number;
};

export function emptyCoverageSummary(fileCount?: number): CoverageSummary {
    return {
        linesTotal: 0,
        linesCovered: 0,
        linesUncovered: 0,
        coveragePercent: 0,
        fileCount,
    };
}

export function buildCoverageSummaryFromFileCoverage(coverage?: FileCoverage): CoverageSummary {
    if (!coverage) {
        return emptyCoverageSummary();
    }

    return {
        linesTotal: coverage.totalLines,
        linesCovered: coverage.coveredLines,
        linesUncovered: Math.max(0, coverage.totalLines - coverage.coveredLines),
        coveragePercent: roundCoveragePercent(coverage.coveragePercent),
    };
}

export function buildCoverageSummaryFromFileIndex(
    fileIndex: Map<string, CovdbFileSummary>,
): CoverageSummary {
    let linesTotal = 0;
    let linesCovered = 0;

    for (const summary of fileIndex.values()) {
        linesTotal += summary.totalLines;
        linesCovered += summary.coveredLines;
    }

    const linesUncovered = Math.max(0, linesTotal - linesCovered);
    return {
        linesTotal,
        linesCovered,
        linesUncovered,
        coveragePercent:
            linesTotal > 0 ? roundCoveragePercent((linesCovered / linesTotal) * 100) : 0,
        fileCount: fileIndex.size,
    };
}

function roundCoveragePercent(value: number): number {
    return Math.round(value * 100) / 100;
}
