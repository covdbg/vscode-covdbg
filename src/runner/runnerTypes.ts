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

export interface ResolvedExecutable {
    path: string;
    source: "setting" | "bundled" | "path" | "install" | "cache";
}
