export interface RunnerSettings {
    executablePath: string;
    portableCachePath: string;
    binaryDiscoveryPattern: string;
    binaryDiscoveryExcludePattern: string;
    licenseServerUrl: string;
    targetArgs: string[];
    analyzeInputs: string[];
    analyzeInputsByTarget: Record<string, string[]>;
    configPath: string;
    outputPath: string;
    appDataPath: string;
    workingDirectory: string;
    env: Record<string, string>;
}

export interface RunnerResolvedPaths {
    workspaceRoot: string;
    configPath?: string;
    configuredOutputPath: string;
    outputPath: string;
    appDataPath: string;
    workingDirectory: string;
}

export interface ResolvedExecutable {
    path: string;
    source: "setting" | "bundled" | "path" | "install" | "cache";
}
