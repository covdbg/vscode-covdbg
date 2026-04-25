import * as vscode from "vscode";

export const COVDBG_EXPLORE_TOOL_NAME = "covdbg_explore";

export type ExploreEnvironmentToolInput = {
    workspaceRoot?: string;
    limit?: number;
};

export type ExploreEnvironmentToolResult = {
    workspaceRoot?: string;
    workspaceFolderName?: string;
    activeEditorPath?: string;
    runtime: {
        resolved: boolean;
        path?: string;
        source?: string;
        version?: string;
    };
    runner: {
        binaryDiscoveryPattern?: string;
        binaryDiscoveryExcludePattern?: string;
        configuredConfigPath?: string;
        resolvedConfigPath?: string;
        configuredOutputPath?: string;
        appDataPath?: string;
        workingDirectory?: string;
    };
    configFiles: {
        discoveredCount: number;
        returnedCount: number;
        paths: string[];
    };
    coverageDatabases: {
        activeCovdbPath?: string;
        discoveredCount: number;
        returnedCount: number;
        paths: string[];
    };
    testBinaries: {
        discoveredCount: number;
        returnedCount: number;
        paths: string[];
    };
    llmGuidance: string[];
    message: string;
};

type ExploreEnvironmentHandler = (
    input: ExploreEnvironmentToolInput,
) => Promise<ExploreEnvironmentToolResult>;

export class ExploreEnvironmentTool implements vscode.LanguageModelTool<ExploreEnvironmentToolInput> {
    constructor(private readonly exploreEnvironment: ExploreEnvironmentHandler) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ExploreEnvironmentToolInput>,
    ): vscode.PreparedToolInvocation {
        const workspaceLabel = options.input.workspaceRoot?.trim() || "the active workspace";
        return {
            invocationMessage: `Inspecting covdbg environment details for ${workspaceLabel}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ExploreEnvironmentToolInput>,
        token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    JSON.stringify(
                        {
                            runtime: { resolved: false },
                            runner: {},
                            configFiles: {
                                discoveredCount: 0,
                                returnedCount: 0,
                                paths: [],
                            },
                            coverageDatabases: {
                                discoveredCount: 0,
                                returnedCount: 0,
                                paths: [],
                            },
                            testBinaries: {
                                discoveredCount: 0,
                                returnedCount: 0,
                                paths: [],
                            },
                            llmGuidance: [],
                            message: "covdbg environment exploration cancelled before start.",
                        },
                        null,
                        2,
                    ),
                ),
            ]);
        }

        const result = await this.exploreEnvironment(options.input);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
    }
}
