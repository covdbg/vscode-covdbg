import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs/promises";

/** The oldest covdbg this extension can drive: 1.3.0 dropped the arguments older ones needed. */
export const MIN_COVDBG_VERSION = "1.3.0";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Versions probed successfully, keyed by path and modification time so a replaced exe is probed
 * again. A failed probe is not kept: a slow first start must not rule covdbg out for the session.
 */
const versionCache = new Map<string, string>();

/** `covdbg --version` prints `covdbg <semver>`. */
export function parseCovdbgVersion(stdout: string): string | undefined {
    return /^covdbg\s+(\d+\.\d+\.\d+\S*)\s*$/m.exec(stdout)?.[1];
}

/** Compares major.minor.patch only, so `0.0.1-debug` is simply 0.0.1. */
export function meetsMinimumVersion(version: string, minimum = MIN_COVDBG_VERSION): boolean {
    const actual = numericParts(version);
    const required = numericParts(minimum);
    for (let i = 0; i < 3; i++) {
        if (actual[i] !== required[i]) {
            return actual[i] > required[i];
        }
    }
    return true;
}

function numericParts(version: string): number[] {
    const [major, minor, patch] = version.split(/[.-]/).map((part) => Number.parseInt(part, 10));
    return [major || 0, minor || 0, patch || 0];
}

/** The version `covdbg --version` reports, or undefined when the file does not answer. */
export async function probeCovdbgVersion(executablePath: string): Promise<string | undefined> {
    let key: string;
    try {
        key = `${executablePath}|${(await fs.stat(executablePath)).mtimeMs}`;
    } catch {
        return undefined;
    }
    let version = versionCache.get(key);
    if (!version) {
        version = await runVersion(executablePath);
        if (version) {
            versionCache.set(key, version);
        }
    }
    return version;
}

function runVersion(executablePath: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawn(executablePath, ["--version"], { windowsHide: true });
        } catch {
            resolve(undefined);
            return;
        }
        let stdout = "";
        const timeout = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.on("error", () => {
            clearTimeout(timeout);
            resolve(undefined);
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            resolve(code === 0 ? parseCovdbgVersion(stdout) : undefined);
        });
    });
}
