import * as vscode from "vscode";
import {
    ExploreUncoveredFilesInput,
    ExploreUncoveredFilesResult,
} from "../coverage/exploreUncoveredFiles";

export const EXPLORE_UNCOVERED_FILES_TOOL_NAME =
    "exploreUncoveredFiles_covdbg";

type ExploreUncoveredFilesHandler = (
    input: ExploreUncoveredFilesInput,
) => Promise<ExploreUncoveredFilesResult>;

export class ExploreUncoveredFilesTool
    implements vscode.LanguageModelTool<ExploreUncoveredFilesInput>
{
    constructor(
        private readonly exploreUncoveredFiles: ExploreUncoveredFilesHandler,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ExploreUncoveredFilesInput>,
    ): vscode.PreparedToolInvocation {
        const limit = options.input.limit ?? 20;
        return {
            invocationMessage: `Exploring up to ${limit} uncovered files`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ExploreUncoveredFilesInput>,
        token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    JSON.stringify({
                        coverageSummary: {
                            linesTotal: 0,
                            linesCovered: 0,
                            linesUncovered: 0,
                            coveragePercent: 0,
                            fileCount: 0,
                        },
                        totalIndexedFiles: 0,
                        returnedFileCount: 0,
                        files: [],
                        llmGuidance: [],
                        message: "Uncovered-file exploration cancelled before start.",
                    }, null, 2),
                ),
            ]);
        }

        const result = await this.exploreUncoveredFiles(options.input);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
    }
}
