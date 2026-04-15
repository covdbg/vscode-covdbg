import * as path from "path";

export interface PendingCovdbReload {
    stateKey: string;
    covdbPath: string;
}

export class CovdbReloadScheduler {
    private activeExecutionCount = 0;
    private readonly pendingReloads = new Map<string, string>();

    beginExecution(): void {
        this.activeExecutionCount++;
    }

    endExecution(): boolean {
        if (this.activeExecutionCount > 0) {
            this.activeExecutionCount--;
        }

        return this.activeExecutionCount === 0;
    }

    hasActiveExecution(): boolean {
        return this.activeExecutionCount > 0;
    }

    hasPendingReloads(): boolean {
        return this.pendingReloads.size > 0;
    }

    queueReload(stateKey: string, covdbPath: string): void {
        this.pendingReloads.set(stateKey, covdbPath);
    }

    drainPendingReloads(
        activeCovdbPathsByState: ReadonlyMap<string, string>,
    ): PendingCovdbReload[] {
        if (this.activeExecutionCount > 0) {
            return [];
        }

        const readyReloads: PendingCovdbReload[] = [];
        for (const [stateKey, queuedPath] of this.pendingReloads) {
            const activePath = activeCovdbPathsByState.get(stateKey);
            if (!activePath) {
                this.pendingReloads.delete(stateKey);
                continue;
            }

            if (normalizePathKey(activePath) !== normalizePathKey(queuedPath)) {
                this.pendingReloads.delete(stateKey);
                continue;
            }

            readyReloads.push({ stateKey, covdbPath: queuedPath });
            this.pendingReloads.delete(stateKey);
        }

        return readyReloads;
    }
}

function normalizePathKey(filePath: string): string {
    return path.normalize(filePath).toLowerCase();
}
