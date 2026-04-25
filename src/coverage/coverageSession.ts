import {
    buildExploreUncoveredFilesResult,
    type ExploreUncoveredFilesInput,
    type ExploreUncoveredFilesResult,
} from "./exploreUncoveredFiles";
import {
    buildUncoveredCodeResult,
    emptyUncoveredCodeResult,
    type UncoveredCodeFileMetadata,
    type UncoveredCodeResult,
} from "./uncoveredCode";
import type {
    CovdbFileCoverageResult,
    CovdbFileSummary,
    CovdbIndexResult,
    FileCoverage,
} from "./covdbParser";

const DEFAULT_MAX_COVERAGE_CACHE_SIZE = 200;

export interface CoverageRepository {
    loadIndex(covdbPath: string): Promise<CovdbIndexResult>;
    loadFileCoverage(covdbPath: string, sourceFilePath: string): Promise<CovdbFileCoverageResult>;
}

export type CoverageWorkspaceSessionSnapshot = {
    activeCovdbPath?: string;
    activeCovdbMtime: number;
    fileIndex: Map<string, CovdbFileSummary>;
    cachedCoverageFileCount: number;
    staleCoverageFileCount: number;
};

export type LoadCoverageIndexOptions = {
    mtime?: number;
    filterFileIndex?: (fileIndex: Map<string, CovdbFileSummary>) => Map<string, CovdbFileSummary>;
};

export type LoadCoverageIndexResult = {
    activeCovdbPath?: string;
    activeCovdbMtime: number;
    fileIndex: Map<string, CovdbFileSummary>;
    loadedFileCount: number;
    totalFileCount: number;
    error?: string;
};

export type BuildUncoveredCodeOptions = {
    metadata?: Partial<UncoveredCodeFileMetadata>;
    noCoverageGuidance?: string[];
};

export class CoverageWorkspaceSession {
    private covdbPath?: string;
    private covdbMtime = 0;
    private index = new Map<string, CovdbFileSummary>();
    private readonly coverageCache = new Map<string, FileCoverage>();
    private readonly staleCoverageKeys = new Set<string>();

    constructor(
        private readonly repository: CoverageRepository,
        private readonly maxCoverageCacheSize = DEFAULT_MAX_COVERAGE_CACHE_SIZE,
    ) {}

    get activeCovdbPath(): string | undefined {
        return this.covdbPath;
    }

    get activeCovdbMtime(): number {
        return this.covdbMtime;
    }

    get fileIndex(): Map<string, CovdbFileSummary> {
        return this.index;
    }

    snapshot(): CoverageWorkspaceSessionSnapshot {
        return {
            activeCovdbPath: this.covdbPath,
            activeCovdbMtime: this.covdbMtime,
            fileIndex: new Map(this.index),
            cachedCoverageFileCount: this.coverageCache.size,
            staleCoverageFileCount: this.staleCoverageKeys.size,
        };
    }

    async loadIndex(
        covdbPath: string,
        options: LoadCoverageIndexOptions = {},
    ): Promise<LoadCoverageIndexResult> {
        const result = await this.repository.loadIndex(covdbPath);
        if (result.error) {
            return {
                activeCovdbPath: this.covdbPath,
                activeCovdbMtime: this.covdbMtime,
                fileIndex: this.index,
                loadedFileCount: this.index.size,
                totalFileCount: result.files.size,
                error: result.error,
            };
        }

        const nextIndex = options.filterFileIndex
            ? options.filterFileIndex(new Map(result.files))
            : new Map(result.files);

        return this.replaceIndex(covdbPath, nextIndex, result.files.size, options.mtime);
    }

    replaceIndex(
        covdbPath: string,
        fileIndex: Map<string, CovdbFileSummary>,
        totalFileCount = fileIndex.size,
        mtime = 0,
    ): LoadCoverageIndexResult {
        this.covdbPath = covdbPath;
        this.covdbMtime = mtime;
        this.index = new Map(fileIndex);
        this.coverageCache.clear();
        this.staleCoverageKeys.clear();

        return {
            activeCovdbPath: this.covdbPath,
            activeCovdbMtime: this.covdbMtime,
            fileIndex: this.index,
            loadedFileCount: this.index.size,
            totalFileCount,
        };
    }

    markCoverageStale(coverageKey: string): void {
        this.staleCoverageKeys.add(coverageKey);
    }

    hasStaleCoverage(coverageKey: string): boolean {
        return this.staleCoverageKeys.has(coverageKey);
    }

    clearCoverage(coverageKey: string): void {
        this.coverageCache.delete(coverageKey);
        this.staleCoverageKeys.delete(coverageKey);
    }

    clear(): void {
        this.covdbPath = undefined;
        this.covdbMtime = 0;
        this.index = new Map();
        this.coverageCache.clear();
        this.staleCoverageKeys.clear();
    }

    async getOrLoadFileCoverage(coverageKey: string): Promise<FileCoverage | undefined> {
        if (!this.covdbPath) {
            return undefined;
        }

        const cachedCoverage = this.coverageCache.get(coverageKey);
        if (cachedCoverage && !this.staleCoverageKeys.has(coverageKey)) {
            this.coverageCache.delete(coverageKey);
            this.coverageCache.set(coverageKey, cachedCoverage);
            return cachedCoverage;
        }

        const result = await this.repository.loadFileCoverage(this.covdbPath, coverageKey);
        if (!result.coverage) {
            this.clearCoverage(coverageKey);
            return undefined;
        }

        if (this.coverageCache.size >= this.maxCoverageCacheSize) {
            const oldestKey = this.coverageCache.keys().next().value;
            if (oldestKey) {
                this.coverageCache.delete(oldestKey);
            }
        }

        this.coverageCache.set(coverageKey, result.coverage);
        this.staleCoverageKeys.delete(coverageKey);
        return result.coverage;
    }

    exploreUncoveredFiles(
        input: ExploreUncoveredFilesInput,
        workspaceRelativePathForFile?: (filePath: string) => string | undefined,
    ): ExploreUncoveredFilesResult {
        return buildExploreUncoveredFilesResult(this.index, {
            ...input,
            activeCovdbPath: this.covdbPath,
            workspaceRelativePathForFile,
        });
    }

    async buildUncoveredCode(
        coverageKey: string,
        resultFilePath: string,
        documentText: string,
        options: BuildUncoveredCodeOptions = {},
    ): Promise<UncoveredCodeResult> {
        const coverage = await this.getOrLoadFileCoverage(coverageKey);
        if (!coverage) {
            return emptyUncoveredCodeResult(resultFilePath, options.noCoverageGuidance);
        }

        return buildUncoveredCodeResult(resultFilePath, documentText, coverage, options.metadata);
    }
}
