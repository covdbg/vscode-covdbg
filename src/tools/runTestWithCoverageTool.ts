import * as path from "path";
import * as vscode from "vscode";

export const RUN_TEST_WITH_COVERAGE_TOOL_NAME = "runTestWithCoverage_covdbg";

export type RunTestWithCoverageToolInput = {
    executablePath: string;
};

export type RunTestWithCoverageToolResult = {
    success: boolean;
    executablePath: string;
    outputPath?: string;
    coverageLoaded: boolean;
    message: string;
    llmGuidance: string[];
};

type RunCoverageHandler = (
    executablePath: string,
) => Promise<RunTestWithCoverageToolResult>;

export class RunTestWithCoverageTool
    implements vscode.LanguageModelTool<RunTestWithCoverageToolInput>
{
    constructor(private readonly runCoverage: RunCoverageHandler) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RunTestWithCoverageToolInput>,
    ): vscode.PreparedToolInvocation {
        const executableName = path.basename(options.input.executablePath);
        return {
            invocationMessage: `Running coverage for ${executableName}`,
            confirmationMessages: {
                title: "Run test executable with coverage?",
                message: `covdbg will execute ${executableName} and refresh workspace coverage results.`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RunTestWithCoverageToolInput>,
        token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    JSON.stringify({
                        success: false,
                        executablePath: options.input.executablePath,
                        coverageLoaded: false,
                        message: "Coverage run cancelled before start.",
                        llmGuidance: [
                            "After rebuilding or changing the test target, call runTestWithCoverage_covdbg again with the executable path.",
                            "When a coverage run succeeds, call getUncoveredCode_covdbg for the relevant source file to inspect the updated uncovered segments.",
                        ],
                    }, null, 2),
                ),
            ]);
        }

        const result = await this.runCoverage(options.input.executablePath);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
    }
}