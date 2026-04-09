import * as path from "path";
import * as vscode from "vscode";
import { emptyCoverageSummary } from "../coverage/coverageSummary";
import { buildCancelledRunCoverageGuidance } from "../coverage/toolGuidance";
import {
    normalizeExecutablePathsInput,
    RUN_TEST_WITH_COVERAGE_TOOL_NAME,
    type RunTestWithCoverageToolInput,
    type RunTestWithCoverageToolResult,
} from "./runTestWithCoverageModel";

type RunCoverageHandler = (
    executablePaths: string[],
) => Promise<RunTestWithCoverageToolResult>;

export class RunTestWithCoverageTool
    implements vscode.LanguageModelTool<RunTestWithCoverageToolInput>
{
    constructor(private readonly runCoverage: RunCoverageHandler) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RunTestWithCoverageToolInput>,
    ): vscode.PreparedToolInvocation {
        const executablePaths = normalizeExecutablePathsInput(options.input);
        const executableName = executablePaths[0]
            ? path.basename(executablePaths[0])
            : "selected tests";
        const executableSummary =
            executablePaths.length <= 1
                ? executableName
                : `${executablePaths.length} executables`;

        return {
            invocationMessage: `Running coverage for ${executableSummary}`,
            confirmationMessages: {
                title: "Run test executables with coverage?",
                message: `covdbg will execute ${executableSummary} and refresh workspace coverage results.`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RunTestWithCoverageToolInput>,
        token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        const executablePaths = normalizeExecutablePathsInput(options.input);

        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    JSON.stringify({
                        success: false,
                        requestedCount: executablePaths.length,
                        completedCount: 0,
                        coverageLoaded: false,
                        coverageSummary: emptyCoverageSummary(),
                        finalizedOutputPath: undefined,
                        mergePerformed: false,
                        mergedInputCount: 0,
                        results: [],
                        message: "Coverage run cancelled before start.",
                        llmGuidance: buildCancelledRunCoverageGuidance(),
                    }, null, 2),
                ),
            ]);
        }

        const result = await this.runCoverage(executablePaths);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
    }
}