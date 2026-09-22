import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { assert, installSpies, openScenarioFolder, steps, treeText, waitFor } from "./harness";

/**
 * A C++ project opened for the first time on a machine already signed in to covdbg, with the real
 * covdbg: quiet start, ▶ offers the starter config once, the run lands coverage in the view, and
 * the second ▶ just runs.
 */
export async function run(): Promise<void> {
    const spies = installSpies();
    let folder = "";

    const findCovdbs = (): string[] =>
        fs
            .readdirSync(folder, { recursive: true, encoding: "utf8" })
            .filter((file) => file.endsWith(".covdb"))
            .map((file) => path.join(folder, file));

    await steps([
        [
            "opening a C++ folder activates the extension",
            async () => {
                folder = await openScenarioFolder();
            },
        ],
        [
            "it reuses the machine's sign-in and finds the test executable",
            async () => {
                await waitFor(
                    "the signed-in state",
                    () => spies.contexts.get("covdbg.auth") === "signedIn",
                );
                const tree = await waitFor("the ready row", async () => {
                    const text = await treeText(spies);
                    return /test_app\.exe/.test(text) && text;
                });
                console.log(indent(tree));
            },
        ],
        [
            "startup shows no notification and does not open the Output panel",
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 3_000));
                assert.deepStrictEqual(spies.messages, []);
                assert.strictEqual(spies.outputShown, 0);
            },
        ],
        [
            "covdbg's MCP server is offered for the folder",
            async () => {
                assert.ok(spies.mcp, "MCP provider registered");
                const definitions =
                    (await spies.mcp.provideMcpServerDefinitions(
                        new vscode.CancellationTokenSource().token,
                    )) ?? [];
                assert.strictEqual(definitions.length, 1);
                const server = definitions[0] as vscode.McpStdioServerDefinition;
                console.log(`    ${server.command} ${server.args.join(" ")}`);
                assert.match(server.command, /covdbg(\.exe)?$/i);
                assert.deepStrictEqual(server.args.slice(0, 2), ["mcp", "--workspace"]);
                assert.strictEqual(
                    path.resolve(server.args[2]).toLowerCase(),
                    path.resolve(folder).toLowerCase(),
                );
            },
        ],
        [
            "▶ offers the starter .covdbg.yaml once, creates it, and runs",
            async () => {
                spies.answers.push({ match: /needs a \.covdbg\.yaml/, item: "Create and run" });
                await vscode.commands.executeCommand("covdbg.runCoverage");
                assert.deepStrictEqual(
                    spies.messages.map((message) => message[1]),
                    ["covdbg needs a .covdbg.yaml."],
                );
                assert.ok(fs.existsSync(path.join(folder, ".covdbg.yaml")), ".covdbg.yaml written");
                assert.ok(findCovdbs().length > 0, "a .covdb was written");
            },
        ],
        [
            "coverage shows in the view, counting only the project's sources",
            async () => {
                const tree = await waitFor("the coverage summary", async () => {
                    const text = await treeText(spies);
                    return /\d+(\.\d+)?%/.test(text) && text;
                }).catch(async (error) => {
                    console.log(indent(await treeText(spies)));
                    console.log(indent(findCovdbs().join("\n")));
                    console.log(indent(spies.log.join("\n")));
                    throw error;
                });
                console.log(indent(tree));
                assert.match(tree, /main\.cpp/);
                assert.doesNotMatch(tree, /vcruntime|crt|stl|Windows Kits/i);
            },
        ],
        [
            "the second ▶ runs the remembered target with no questions",
            async () => {
                const before = spies.messages.length;
                const covdb = findCovdbs()[0];
                const firstWrite = fs.statSync(covdb).mtimeMs;
                await vscode.commands.executeCommand("covdbg.runCoverage");
                assert.strictEqual(spies.messages.length, before, "no new messages");
                assert.ok(fs.statSync(covdb).mtimeMs > firstWrite, "the .covdb was rewritten");
                assert.strictEqual(spies.outputShown, 0, "the Output panel stayed closed");
            },
        ],
    ]);
}

function indent(text: string): string {
    return text
        .split("\n")
        .map((line) => `    | ${line}`)
        .join("\n");
}
