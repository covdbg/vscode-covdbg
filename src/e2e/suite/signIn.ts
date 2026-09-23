import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { assert, installSpies, openScenarioFolder, steps, treeText, waitFor } from "./harness";

/**
 * A machine not signed in to covdbg. covdbg.executablePath points at the covdbg stand-in, which
 * keeps its sign-in in FAKE_COVDBG_STATE (a "confirm" file there is the user confirming in the
 * browser) and hands runs to the real covdbg.
 */
export async function run(): Promise<void> {
    const spies = installSpies();
    const state = process.env.FAKE_COVDBG_STATE ?? "";
    assert.ok(state, "FAKE_COVDBG_STATE is set");
    let folder = "";
    const tree = () => treeText(spies);
    const auth = () => spies.contexts.get("covdbg.auth");
    const confirmInBrowser = () => fs.writeFileSync(path.join(state, "confirm"), "");
    const covdb = () => path.join(folder, ".covdbg", "coverage.covdb");

    await steps([
        [
            "signed out, the view offers sign-in without a toast",
            async () => {
                folder = await openScenarioFolder();
                await waitFor(
                    "the signed-out welcome",
                    () => spies.contexts.get("covdbg.welcome") === "signedOut",
                );
                assert.strictEqual(auth(), "signedOut");
                await new Promise((resolve) => setTimeout(resolve, 2_000));
                assert.deepStrictEqual(spies.messages, []);
            },
        ],
        [
            "▶ while signed out starts sign-in: browser opened once, code in the view",
            async () => {
                spies.answers.push({ match: /needs a \.covdbg\.yaml/, item: "Create and run" });
                void vscode.commands.executeCommand("covdbg.runCoverage");
                await waitFor("signing in", () => auth() === "signingIn");
                assert.deepStrictEqual(spies.opened, [
                    "https://app.covdbg.com/device?code=E2EE-TEST",
                ]);
                const text = await waitFor("the code row", async () => {
                    const current = await tree();
                    return /E2EE-TEST/.test(current) && current;
                });
                console.log(indent(text));
            },
        ],
        [
            "Cancel stops the sign-in and skips the run, silently",
            async () => {
                await vscode.commands.executeCommand("covdbg.cancelSignIn");
                await waitFor("signed out again", () => auth() === "signedOut");
                await new Promise((resolve) => setTimeout(resolve, 1_000));
                assert.ok(!fs.existsSync(covdb()), "nothing ran");
                assert.deepStrictEqual(spies.messages, []);
            },
        ],
        [
            "Stop in the Testing view cancels the pre-run sign-in and ends covdbg login",
            async () => {
                void vscode.commands.executeCommand("testing.runAll");
                await waitFor("signing in", () => auth() === "signingIn");
                assert.match(spies.statusBar.text ?? "", /Sign in to covdbg/);
                assert.strictEqual(loginProcesses(), 1, "one covdbg login is running");
                await vscode.commands.executeCommand("testing.cancelRun");
                await waitFor("signed out again", () => auth() === "signedOut");
                await waitFor("covdbg login to end", () => loginProcesses() === 0, 10_000);
                assert.ok(!fs.existsSync(covdb()), "nothing ran");
                assert.deepStrictEqual(spies.messages, []);
            },
        ],
        [
            "▶ again, confirm in the browser: the same run goes on and coverage appears",
            async () => {
                const running = vscode.commands.executeCommand("covdbg.runCoverage");
                await waitFor("signing in", () => auth() === "signingIn");
                confirmInBrowser();
                await running;
                assert.strictEqual(auth(), "signedIn");
                assert.ok(fs.existsSync(covdb()), "the run went on after sign-in");
                const text = await waitFor("coverage and the account", async () => {
                    const current = await tree();
                    return /%/.test(current) && /e2e@example\.com/.test(current) && current;
                });
                console.log(indent(text));
                // The only message is the starter-config question.
                assert.deepStrictEqual(
                    spies.messages.map((message) => message[1]),
                    ["covdbg needs a .covdbg.yaml."],
                );
            },
        ],
        [
            "Sign Out asks first, then shows signed out",
            async () => {
                spies.answers.push({ match: /^Sign out of covdbg\?$/, item: "Sign Out" });
                await vscode.commands.executeCommand("covdbg.signOut");
                assert.strictEqual(
                    spies.messages[spies.messages.length - 1]?.[1],
                    "Sign out of covdbg?",
                );
                await waitFor("signed out", () => auth() === "signedOut");
                assert.ok(!fs.existsSync(path.join(state, "signed-in")));
            },
        ],
        [
            "a sign-in done in a terminal is picked up on refresh",
            async () => {
                fs.writeFileSync(path.join(state, "signed-in"), "");
                await vscode.commands.executeCommand("covdbg.refresh");
                await waitFor("signed in", () => auth() === "signedIn");
                fs.rmSync(path.join(state, "signed-in"));
                await vscode.commands.executeCommand("covdbg.refresh");
                await waitFor("signed out", () => auth() === "signedOut");
            },
        ],
        [
            "a sign-in covdbg refuses shows one error toast",
            async () => {
                const before = spies.messages.length;
                const signingIn = vscode.commands.executeCommand("covdbg.signIn");
                await waitFor("signing in", () => auth() === "signingIn");
                fs.writeFileSync(path.join(state, "deny"), "");
                await signingIn;
                await waitFor("signed out", () => auth() === "signedOut");
                const shown = spies.messages.slice(before);
                console.log(indent(shown.map((message) => message.join(" | ")).join("\n")));
                assert.strictEqual(shown.length, 1);
                assert.strictEqual(shown[0][0], "error");
                assert.strictEqual(shown[0][1], "covdbg: The sign-in was refused in the browser.");
            },
        ],
    ]);
}

/** How many covdbg stand-ins are running `login` right now. */
function loginProcesses(): number {
    const out = execFileSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-Command",
            "@(Get-CimInstance Win32_Process -Filter \"Name='covdbg.exe'\" | Where-Object { $_.CommandLine -match ' login' -and $_.ExecutablePath -match 'fake-build' }).Count",
        ],
        { encoding: "utf8" },
    );
    return Number(out.trim());
}

function indent(text: string): string {
    return text
        .split("\n")
        .map((line) => `    | ${line}`)
        .join("\n");
}
