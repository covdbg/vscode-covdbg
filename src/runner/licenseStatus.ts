import * as fs from "fs/promises";
import * as path from "path";

export interface LicenseStatusSnapshot {
    type?: string;
    status?: string;
    source?: string;
    message?: string;
    errorCode?: string;
    daysRemaining?: number;
    expirationTimestamp?: number;
    expiresAt?: string;
    lastUpdatedTimestamp?: number;
    isFirstIssue?: boolean;
}

export function getLicenseStatusPath(appDataPath: string): string {
    return path.join(appDataPath, "license_status.json");
}

export async function readLicenseStatus(
    appDataPath: string,
): Promise<LicenseStatusSnapshot | undefined> {
    const filePath = getLicenseStatusPath(appDataPath);
    try {
        const content = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(content) as LicenseStatusSnapshot;
        if (!parsed || typeof parsed !== "object") {
            return undefined;
        }
        return parsed;
    } catch {
        return undefined;
    }
}
