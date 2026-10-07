import { vscodeStub } from "./vscodeStub";
import test from "node:test";
import assert from "node:assert/strict";
import { AuthService, SIGN_IN_TO_RUN } from "../auth/authService";
import type { RuntimeState } from "../runner/runnerTypes";
import { FakeProcess, answerWhoami, fakeCovdbg, settle } from "./fakeCovdbg";

const OK: RuntimeState = {
    kind: "ok",
    path: "C:/covdbg/covdbg.exe",
    version: "1.3.0",
    source: "path",
};
const PROMPT =
    "\n  Open https://app.covdbg.com/device?code=ABCD-1234\n" +
    "  and confirm the code there:  ABCD-1234\n\nWaiting for you to finish...\n";

/** A machine whose sign-in the test controls; `login` processes are left for the test to drive. */
function machine(
    options: { runtime?: RuntimeState; settingsEnv?: Record<string, string>; json?: boolean } = {},
) {
    const state = {
        email: undefined as string | undefined,
        team: undefined as { id: string; name: string; slug: string; kind: string } | undefined,
    };
    const covdbg = fakeCovdbg((process) => {
        if (process.args[0] === "whoami") {
            answerWhoami(
                process,
                state.email
                    ? {
                          email: state.email,
                          ...(state.team && {
                              accountId: state.team.id,
                              teamName: state.team.name,
                              teamSlug: state.team.slug,
                              teamKind: state.team.kind,
                          }),
                      }
                    : undefined,
                options.json ?? false,
            );
        }
    });
    const auth = new AuthService({
        resolveRuntime: async () => options.runtime ?? OK,
        readSettingsEnv: () => options.settingsEnv ?? {},
        start: covdbg.start,
    });
    const logins = () => covdbg.started.filter((process) => process.args[0] === "login");
    const whoamis = () => covdbg.started.filter((process) => process.args[0] === "whoami");
    return { state, auth, logins, whoamis };
}

async function nextLogin(logins: () => FakeProcess[]): Promise<FakeProcess> {
    while (logins().length === 0) {
        await settle();
    }
    return logins()[logins().length - 1];
}

test.beforeEach(() => {
    vscodeStub.env.opened = [];
    vscodeStub.window.toasts = [];
    vscodeStub.commands.context.clear();
});

test("whoami's answer becomes the state, and the context keys follow", async () => {
    const { state, auth } = machine();
    await auth.refresh();
    assert.deepEqual(auth.state, { kind: "signedOut" });
    assert.equal(vscodeStub.commands.context.get("covdbg.auth"), "signedOut");

    state.email = "dev@example.com";
    await auth.refresh();
    assert.deepEqual(auth.state, { kind: "signedIn", email: "dev@example.com" });
});

test("a covdbg that knows whoami --json gives the account and team", async () => {
    const { state, auth, whoamis } = machine({ json: true });
    await auth.refresh();
    assert.deepEqual(auth.state, { kind: "signedOut" });

    state.email = "a@acme.com";
    state.team = { id: "acc_1", name: "Acme", slug: "acme", kind: "team" };
    await auth.refresh();
    assert.deepEqual(auth.state, {
        kind: "signedIn",
        email: "a@acme.com",
        accountId: "acc_1",
        teamName: "Acme",
        teamSlug: "acme",
        teamKind: "team",
    });
    assert.deepEqual(
        whoamis().map((process) => process.args),
        [
            ["whoami", "--json"],
            ["whoami", "--json"],
        ],
    );
});

test("an older covdbg without --json is asked again the old way", async () => {
    const { state, auth, whoamis } = machine({ json: false });
    state.email = "dev@example.com";
    await auth.refresh();
    assert.deepEqual(auth.state, { kind: "signedIn", email: "dev@example.com" });
    assert.deepEqual(
        whoamis().map((process) => process.args),
        [["whoami", "--json"], ["whoami"]],
    );
});

test("a project token wins over the sign-in, from covdbg.runner.env or the editor's environment", async () => {
    const fromSettings = machine({ settingsEnv: { COVDBG_PROJECT_TOKEN: "cvt_123" } });
    await fromSettings.auth.refresh();
    assert.deepEqual(fromSettings.auth.state, { kind: "token" });
    assert.equal(fromSettings.whoamis().length, 0);
    assert.equal(fromSettings.logins().length, 0);

    process.env.COVDBG_PROJECT_TOKEN = "cvt_456";
    try {
        const fromProcess = machine();
        await fromProcess.auth.refresh();
        assert.deepEqual(fromProcess.auth.state, { kind: "token" });
    } finally {
        delete process.env.COVDBG_PROJECT_TOKEN;
    }
});

test("no usable covdbg makes sign-in unavailable, and a run is skipped with the reason", async () => {
    const runtime: RuntimeState = {
        kind: "tooOld",
        path: "C:/old/covdbg.exe",
        version: "1.2.0",
        fromSetting: false,
    };
    const { auth, whoamis, logins } = machine({ runtime });
    const readiness = await auth.ensureReadyToRun();
    assert.deepEqual(auth.state, { kind: "unavailable", runtime });
    assert.equal(readiness.run, false);
    assert.match(!readiness.run ? readiness.reason : "", /1\.2\.0/);
    assert.equal(whoamis().length + logins().length, 0);
});

test("signed out, a run signs in first and then goes on", async () => {
    const { state, auth, logins } = machine();
    const readiness = auth.ensureReadyToRun();

    const login = await nextLogin(logins);
    login.print(PROMPT);
    assert.deepEqual(auth.state, {
        kind: "signingIn",
        url: "https://app.covdbg.com/device?code=ABCD-1234",
        code: "ABCD-1234",
    });
    assert.deepEqual(vscodeStub.env.opened, ["https://app.covdbg.com/device?code=ABCD-1234"]);
    await auth.copySignInCode();
    assert.equal(vscodeStub.env.clipboard.text, "ABCD-1234");

    state.email = "dev@example.com";
    login.print("Signed in as dev@example.com.\n");
    login.exit(0);
    assert.deepEqual(await readiness, { run: true });
    assert.deepEqual(auth.state, { kind: "signedIn", email: "dev@example.com" });
    assert.deepEqual(vscodeStub.window.toasts, []);
});

test("cancelling the sign-in skips the run quietly", async () => {
    const { auth, logins } = machine();
    const readiness = auth.ensureReadyToRun();
    const login = await nextLogin(logins);
    login.print(PROMPT);
    auth.cancelSignIn();

    assert.deepEqual(await readiness, { run: false, reason: SIGN_IN_TO_RUN });
    assert.equal(login.killed, true);
    assert.deepEqual(auth.state, { kind: "signedOut" });
    assert.equal(auth.lastRunNotice?.action, "signIn");
    assert.deepEqual(vscodeStub.window.toasts, []);
});

test("only one covdbg login runs; a second sign-in opens its page again", async () => {
    const { state, auth, logins } = machine();
    const first = auth.signIn();
    const login = await nextLogin(logins);
    login.print(PROMPT);
    const second = auth.signIn();

    assert.equal(logins().length, 1);
    assert.equal(vscodeStub.env.opened.length, 2);

    state.email = "dev@example.com";
    login.exit(0);
    assert.equal(await first, true);
    assert.equal(await second, true);
});

test("a failed sign-in is the only one that shows a toast", async () => {
    const { auth, logins } = machine();
    const signedIn = auth.signIn();
    const login = await nextLogin(logins);
    login.print(PROMPT + "The sign-in was refused in the browser.\n");
    login.exit(1);

    assert.equal(await signedIn, false);
    assert.deepEqual(vscodeStub.window.toasts, ["covdbg: The sign-in was refused in the browser."]);
    assert.deepEqual(auth.state, { kind: "signedOut" });
});

test("when whoami itself fails, a run goes ahead and covdbg decides", async () => {
    const covdbg = fakeCovdbg((process) => process.exit(3));
    const auth = new AuthService({
        resolveRuntime: async () => OK,
        readSettingsEnv: () => ({}),
        start: covdbg.start,
    });
    assert.deepEqual(await auth.ensureReadyToRun(), { run: true });
    assert.equal(auth.state.kind, "error");
});

test("a run whose sign-in has ended signs the editor out and keeps the notice", async () => {
    const { state, auth } = machine();
    state.email = "dev@example.com";
    await auth.refresh();
    let changes = 0;
    auth.onDidChange(() => changes++);

    auth.applyRunNotices([
        { kind: "gated", message: "gated" },
        { kind: "sessionInvalid", message: "Your sign-in has ended.", action: "signIn" },
    ]);
    assert.deepEqual(auth.state, { kind: "signedOut" });
    assert.equal(auth.lastRunNotice?.kind, "sessionInvalid");
    assert.ok(changes > 0);

    auth.applyRunNotices([]);
    assert.equal(auth.lastRunNotice, undefined);

    auth.applyRunNotices([{ kind: "gated", message: "gated" }]);
    auth.clearLastRunNotice();
    assert.equal(auth.lastRunNotice, undefined);

    // whoami still reads the stored credential; the ended sign-in holds until the editor signs in.
    await auth.refresh();
    assert.deepEqual(auth.state, { kind: "signedOut" });
});

test("signing out asks first and passes on the service's problem", async () => {
    const { state, auth } = machine();
    state.email = "dev@example.com";

    vscodeStub.window.warningAnswer = undefined;
    await auth.signOut();
    assert.equal(vscodeStub.window.toasts.length, 1);

    vscodeStub.window.toasts = [];
    vscodeStub.window.warningAnswer = "Sign Out";
    const covdbg = fakeCovdbg((process) => {
        if (process.args[0] === "logout") {
            process.print(
                "Signed out dev@example.com.\ncovdbg: the session could not be ended on the service (timed out); it stays listed.\n",
            );
            process.exit(0);
        } else {
            process.print("Not signed in.\n");
            process.exit(1);
        }
    });
    const signingOut = new AuthService({
        resolveRuntime: async () => OK,
        readSettingsEnv: () => ({}),
        start: covdbg.start,
    });
    await signingOut.signOut();
    vscodeStub.window.warningAnswer = undefined;

    assert.deepEqual(
        covdbg.started.map((process) => process.args[0]),
        ["logout", "whoami", "whoami"],
    );
    assert.deepEqual(vscodeStub.window.toasts, [
        "Sign out of covdbg?",
        "covdbg: the session could not be ended on the service (timed out); it stays listed.",
    ]);
    assert.deepEqual(signingOut.state, { kind: "signedOut" });
});
