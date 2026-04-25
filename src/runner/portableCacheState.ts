import * as fs from "fs/promises";

export interface PortableArchiveStamp {
    size: number;
    mtimeMs: number;
}

interface PortableCacheState {
    archive: PortableArchiveStamp;
}

export async function readPortableArchiveStamp(
    filePath: string,
): Promise<PortableArchiveStamp | undefined> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<PortableCacheState>;
        const archive = parsed.archive;
        if (!archive || typeof archive.size !== "number" || typeof archive.mtimeMs !== "number") {
            return undefined;
        }
        return {
            size: archive.size,
            mtimeMs: archive.mtimeMs,
        };
    } catch {
        return undefined;
    }
}

export async function writePortableArchiveStamp(
    filePath: string,
    archive: PortableArchiveStamp,
): Promise<void> {
    const state: PortableCacheState = { archive };
    await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function portableArchiveStampMatches(
    expected: PortableArchiveStamp,
    actual: PortableArchiveStamp | undefined,
): boolean {
    return !!actual && actual.size === expected.size && actual.mtimeMs === expected.mtimeMs;
}
