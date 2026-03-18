export interface RunnerSettings {
    executablePath: string;
    portableCachePath: string;
    binaryDiscoveryPattern: string;
    licenseServerUrl: string;
    targetExecutable: string;
    targetArgs: string[];
    configPath: string;
    outputPath: string;
    appDataPath: string;
    workingDirectory: string;
    env: Record<string, string>;
}

export interface RunnerResolvedPaths {
    workspaceRoot: string;
    targetExecutablePath: string;
    configPath?: string;
    outputPath: string;
    appDataPath: string;
    workingDirectory: string;
}

export interface ResolvedExecutable {
    path: string;
    source: "setting" | "bundled" | "path" | "install" | "cache";
}
