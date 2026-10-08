export interface RunnerSettings {
    executablePath: string;
    portableCachePath: string;
    binaryDiscoveryPattern: string;
    binaryDiscoveryExcludePattern: string;
    targetArgs: string[];
    configPath: string;
    outputPath: string;
    workingDirectory: string;
    env: Record<string, string>;
}

export interface RunnerResolvedPaths {
    workspaceRoot: string;
    configPath?: string;
    configuredOutputPath: string;
    outputPath: string;
    /** Where covdbg keeps its logs: `.covdbg` under the directory it is started from. */
    appDataPath: string;
    workingDirectory: string;
}

export type RuntimeSource = "setting" | "path" | "install" | "bundled" | "cache";

/** What the extension can run: a covdbg new enough to use, or why there is none. */
export type RuntimeState =
    | { kind: "ok"; path: string; version: string; source: RuntimeSource }
    | { kind: "missing" }
    | { kind: "tooOld"; path: string; version?: string; fromSetting: boolean }
    | { kind: "unsupported"; reason: "remote" | "platform" | "untrusted" };
