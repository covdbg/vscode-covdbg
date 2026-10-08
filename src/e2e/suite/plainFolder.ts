import * as vscode from "vscode";
import { EXTENSION_ID, assert, steps } from "./harness";

/** A folder with no C++ and no covdbg files: the extension stays asleep. */
export async function run(): Promise<void> {
    await steps([
        [
            "the extension does not activate in a non-C++ folder",
            async () => {
                // Give workspaceContains activation time to happen if it were going to.
                await new Promise((resolve) => setTimeout(resolve, 5_000));
                const extension = vscode.extensions.getExtension(EXTENSION_ID);
                assert.ok(extension, "extension is installed");
                assert.strictEqual(extension.isActive, false);
            },
        ],
    ]);
}
