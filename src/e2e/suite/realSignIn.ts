import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { assert, installSpies, openScenarioFolder, steps, treeText, waitFor } from "./harness";

/**
 * The real thing, run only when asked for by name: signs this machine out of covdbg, then signs
 * in again through app.covdbg.com. The device page is written to COVDBG_E2E_SIGN_IN_URL (and
 * printed) for a person, or a browser driver, to confirm within ten minutes. If nobody does, the
 * machine stays signed out until `covdbg login`.
 */
export async function run(): Promise<void> {
    const spies = installSpies();
    const urlFile = process.env.COVDBG_E2E_SIGN_IN_URL ?? "";
    assert.ok(urlFile, "COVDBG_E2E_SIGN_IN_URL is set");
    fs.rmSync(urlFile, { force: true });
    let folder = "";
    const auth = () => spies.contexts.get("covdbg.auth");

    await steps([
        [
            "signed in, the extension reuses the machine's sign-in",
            async () => {
                folder = await openScenarioFolder();
                await waitFor("signed in", () => auth() === "signedIn");
            },
        ],
        [
            "Sign Out signs the machine out of covdbg",
            async () => {
                spies.answers.push({ match: /^Sign out of covdbg\?$/, item: "Sign Out" });
                await vscode.commands.executeCommand("covdbg.signOut");
                await waitFor("signed out", () => auth() === "signedOut");
            },
        ],
        [
            "▶ signs in through app.covdbg.com (confirm the code in the browser) and runs",
            async () => {
                spies.answers.push({ match: /needs a \.covdbg\.yaml/, item: "Create and run" });
                const running = vscode.commands.executeCommand("covdbg.runCoverage");
                const url = await waitFor("the device page", () => spies.opened[0]);
                assert.match(url, /^https:\/\/app\.covdbg\.com\/device\?code=[A-Z0-9-]+$/);
                fs.writeFileSync(urlFile, url);
                console.log(`    CONFIRM IN THE BROWSER: ${url}`);
                await waitFor("the sign-in to be confirmed", () => auth() === "signedIn", 600_000);
                await running;
                assert.ok(
                    fs.existsSync(path.join(folder, ".covdbg", "coverage.covdb")),
                    "the run went on after sign-in",
                );
                const tree = await waitFor("coverage and the account", async () => {
                    const text = await treeText(spies);
                    return /%/.test(text) && /Signed in as/.test(text) && text;
                });
                console.log(
                    tree
                        .split("\n")
                        .map((line) => `    | ${line}`)
                        .join("\n"),
                );
                assert.deepStrictEqual(
                    spies.messages.map((message) => message[1]),
                    ["Sign out of covdbg?", "covdbg needs a .covdbg.yaml."],
                );
            },
        ],
    ]);
}
