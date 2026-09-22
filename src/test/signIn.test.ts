import test from "node:test";
import assert from "node:assert/strict";
import { parseSignOut, parseSignedInAs, querySignIn, signIn, signOut } from "../runner/signIn";
import { fakeCovdbg, settle } from "./fakeCovdbg";

const EXE = "C:/covdbg/covdbg.exe";
const PROMPT =
    "\n  Open https://app.covdbg.com/device?code=ABCD-1234\n" +
    "  and confirm the code there:  ABCD-1234\n\nWaiting for you to finish...\n";

test("parseSignedInAs reads the email out of what covdbg prints", () => {
    assert.equal(parseSignedInAs("Signed in as dev@example.com.\r\n"), "dev@example.com");
    assert.equal(parseSignedInAs("Not signed in.\n"), undefined);
});

test("parseSignedInAs ignores the line about a sign-in being replaced", () => {
    const stdout = "Already signed in as old@example.com. Signing in again replaces it.\n";
    assert.equal(parseSignedInAs(stdout), undefined);
    assert.equal(parseSignedInAs(stdout + "Signed in as new@example.com.\n"), "new@example.com");
});

test("whoami decides by its exit code and reads only the email from the text", async () => {
    const cases: [string, number, unknown][] = [
        ["Signed in as dev@example.com.\r\n", 0, { kind: "signedIn", email: "dev@example.com" }],
        ["", 0, { kind: "signedIn", email: undefined }],
        ["Not signed in.\r\n", 1, { kind: "signedOut" }],
    ];
    for (const [stdout, code, expected] of cases) {
        const covdbg = fakeCovdbg((process) => {
            process.print(stdout);
            process.exit(code);
        });
        assert.deepEqual(await querySignIn(EXE, { marker: "1" }, covdbg.start), expected);
        assert.deepEqual(covdbg.started[0].args, ["whoami"]);
        assert.equal(covdbg.started[0].env.marker, "1");
    }
});

test("sign-in announces the page once, even when the prompt arrives in pieces", async () => {
    const prompts: unknown[] = [];
    const covdbg = fakeCovdbg(() => undefined);
    const result = signIn(
        EXE,
        {},
        (prompt) => prompts.push(prompt),
        new AbortController().signal,
        covdbg.start,
    );
    const login = covdbg.started[0];
    assert.deepEqual(login.args, ["login"]);

    login.print("\n  Open https://app.covdbg.com/dev");
    login.print("ice?code=ABCD-1234\r\n  and confirm the code the");
    assert.equal(prompts.length, 0);
    login.print("re:  ABCD-1234\r\n\r\nWaiting for you to finish...\r\n");
    assert.deepEqual(prompts, [
        { url: "https://app.covdbg.com/device?code=ABCD-1234", code: "ABCD-1234" },
    ]);

    login.print(
        "Signed in as dev@example.com.\nSeats, teams and your personal lock are managed at ",
    );
    login.print("https://app.covdbg.com\n");
    login.exit(0);
    assert.deepEqual(await result, { kind: "signedIn", email: "dev@example.com" });
    assert.equal(prompts.length, 1);
});

test("a bare 'Signed in.' is a sign-in without an email", async () => {
    const covdbg = fakeCovdbg((process) => {
        process.print(PROMPT + "Signed in.\n");
        process.exit(0);
    });
    const result = await signIn(
        EXE,
        {},
        () => undefined,
        new AbortController().signal,
        covdbg.start,
    );
    assert.deepEqual(result, { kind: "signedIn", email: undefined });
});

test("a failed sign-in reports the line covdbg printed on stdout", async () => {
    const covdbg = fakeCovdbg((process) => {
        process.print(PROMPT + "The code expired before it was entered.\n");
        process.exit(1);
    });
    const result = await signIn(
        EXE,
        {},
        () => undefined,
        new AbortController().signal,
        covdbg.start,
    );
    assert.deepEqual(result, {
        kind: "failed",
        message: "The code expired before it was entered.",
    });
});

test("cancelling a sign-in kills covdbg login", async () => {
    const abort = new AbortController();
    const covdbg = fakeCovdbg((process) => process.print(PROMPT));
    const result = signIn(EXE, {}, () => undefined, abort.signal, covdbg.start);
    await settle();
    abort.abort();
    assert.deepEqual(await result, { kind: "cancelled" });
    assert.equal(covdbg.started[0].killed, true);
});

test("sign-out passes on the 'Signed out' line and the service's problem", async () => {
    const stdout =
        "Signed out dev@example.com.\r\n" +
        "covdbg: the session could not be ended on the service (timed out); it stays listed under " +
        "your sessions until it expires. End it at https://app.covdbg.com\r\n" +
        "Your seats and personal lock stay as they are; manage them at https://app.covdbg.com\r\n";
    const covdbg = fakeCovdbg((process) => {
        process.print(stdout);
        process.exit(0);
    });
    assert.deepEqual(await signOut(EXE, {}, covdbg.start), {
        ok: true,
        message: "Signed out dev@example.com.",
        serviceProblem:
            "covdbg: the session could not be ended on the service (timed out); it stays listed " +
            "under your sessions until it expires. End it at https://app.covdbg.com",
    });
    assert.deepEqual(covdbg.started[0].args, ["logout"]);

    assert.deepEqual(
        parseSignOut(
            "Signed out dev@example.com.\nYour seats and personal lock stay as they are; manage them at https://app.covdbg.com\n",
        ),
        { message: "Signed out dev@example.com.", serviceProblem: undefined },
    );
});
