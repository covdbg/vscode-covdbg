import {
    buildCoverageSummaryFromFileIndex,
    type CoverageSummary,
} from "./coverageSummary";
import { CovdbFileSummary } from "./covdbParser";
import { buildExploreUncoveredFilesLlmGuidance } from "./toolGuidance";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type ExploreUncoveredFilesInput = {
    limit?: number;
    maxCoveragePercent?: number;
};

export type ExploreUncoveredFileEntry = {
    filePath: string;
    workspaceRelativePath?: string;
    fileName: string;
    coveragePercent: number;
    linesCovered: number;
    linesUncovered: number;
    linesTotal: number;
};

export type ExploreUncoveredFilesResult = {
    activeCovdbPath?: string;
    coverageSummary: CoverageSummary;
    totalIndexedFiles: number;
    returnedFileCount: number;
    files: ExploreUncoveredFileEntry[];
    llmGuidance: string[];
    message: string;
};

interface BuildExploreUncoveredFilesOptions extends ExploreUncoveredFilesInput {
    activeCovdbPath?: string;
    workspaceRelativePathForFile?: (filePath: string) => string | undefined;
}

export function buildExploreUncoveredFilesResult(
    fileIndex: Map<string, CovdbFileSummary>,
    options: BuildExploreUncoveredFilesOptions = {},
): ExploreUncoveredFilesResult {
    const maxCoveragePercent = Math.max(
        0,
        Math.min(100, options.maxCoveragePercent ?? 100),
    );
    const limit = Math.max(
        1,
        Math.min(MAX_LIMIT, Math.floor(options.limit ?? DEFAULT_LIMIT)),
    );

    const files = [...fileIndex.values()]
        .map((summary) => {
            const linesUncovered = Math.max(
                0,
                summary.totalLines - summary.coveredLines,
            );

            return {
                filePath: summary.filePath,
                workspaceRelativePath: options.workspaceRelativePathForFile?.(
                    summary.filePath,
                ),
                fileName: summary.filePath.replace(/^.*[\\/]/, ""),
                coveragePercent: roundCoveragePercent(summary.coveragePercent),
                linesCovered: summary.coveredLines,
                linesUncovered,
                linesTotal: summary.totalLines,
            } satisfies ExploreUncoveredFileEntry;
        })
        .filter(
            (entry) =>
                entry.linesUncovered > 0 &&
                entry.coveragePercent <= maxCoveragePercent,
        )
        .sort((left, right) => {
            if (left.linesUncovered !== right.linesUncovered) {
                return right.linesUncovered - left.linesUncovered;
            }
            if (left.coveragePercent !== right.coveragePercent) {
                return left.coveragePercent - right.coveragePercent;
            }
            return left.filePath.localeCompare(right.filePath);
        })
        .slice(0, limit);

    return {
        activeCovdbPath: options.activeCovdbPath,
        coverageSummary: buildCoverageSummaryFromFileIndex(fileIndex),
        totalIndexedFiles: fileIndex.size,
        returnedFileCount: files.length,
        files,
        llmGuidance: buildExploreUncoveredFilesLlmGuidance(),
        message:
            files.length > 0
                ? `Found ${files.length} uncovered file${files.length === 1 ? "" : "s"}.`
                : "No uncovered files matched the current coverage filters.",
    };
}

function roundCoveragePercent(value: number): number {
    return Math.round(value * 100) / 100;
}