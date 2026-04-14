import * as path from "path";
import * as vscode from "vscode";
import { UncoveredCodeResult } from "../coverage/uncoveredCode";

export const GET_UNCOVERED_CODE_TOOL_NAME = "getUncoveredCode_covdbg";

export type GetUncoveredCodeToolInput = {
    filePath?: string;
};

type GetUncoveredCodeHandler = (
    filePath?: string,
) => Promise<UncoveredCodeResult>;

export class GetUncoveredCodeTool
    implements vscode.LanguageModelTool<GetUncoveredCodeToolInput>
{
    constructor(private readonly getUncoveredCode: GetUncoveredCodeHandler) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GetUncoveredCodeToolInput>,
    ): vscode.PreparedToolInvocation {
        const target = options.input.filePath
            ? path.basename(options.input.filePath)
            : "the active file";

        return {
            invocationMessage: `Reading uncovered code for ${target}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GetUncoveredCodeToolInput>,
        token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        if (token.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    JSON.stringify({
                        file: options.input.filePath ?? "",
                        coverage: {
                            linesTotal: 0,
                            linesCovered: 0,
                            linesUncovered: 0,
                            coveragePercent: 0,
                        },
                        uncoveredSegments: [],
                    }),
                ),
            ]);
        }

        const result = await this.getUncoveredCode(options.input.filePath);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
    }
}
