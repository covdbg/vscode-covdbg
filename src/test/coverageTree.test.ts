import "./vscodeStub";
import test from "node:test";
import assert from "node:assert/strict";
import {
    CoverageViewInput,
    CoverageRow,
    describeCoverageView,
    formatAge,
} from "../views/coverageTree";
import type { RuntimeState } from "../runner/runnerTypes";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const OK: RuntimeState = { kind: "ok", path: "C:/covdbg.exe", version: "1.3.0", source: "path" };

function input(overrides: Partial<CoverageViewInput> = {}): CoverageViewInput {
    return {
        auth: { kind: "signedIn", email: "dev@example.com" },
        runtime: OK,
        targets: ["build/Debug/test_app.exe"],
        coverage: [],
        multiRoot: false,
        now: NOW,
        ...overrides,
    };
}

const LOADED = {
    folderName: "app",
    covdbPath: "C:/app/.covdbg/coverage.covdb",
    mtime: NOW - 2 * 60_000,
    files: [
        {
            filePath: "C:/app/src/parser.cpp",
            totalLines: 100,
            coveredLines: 31,
            coveragePercent: 31,
        },
        { filePath: "C:/app/src/main.cpp", totalLines: 100, coveredLines: 90, coveragePercent: 90 },
        { filePath: "C:/app/src/empty.h", totalLines: 0, coveredLines: 0, coveragePercent: 0 },
    ],
};

const labels = (rows: CoverageRow[]) => rows.map((row) => row.label);

test("covdbg that cannot run here, or is missing or too old, is a welcome state", () => {
    const unavailable = (runtime: Exclude<RuntimeState, { kind: "ok" }>) =>
        describeCoverageView(input({ auth: { kind: "unavailable", runtime } }));

    assert.deepEqual(unavailable({ kind: "unsupported", reason: "untrusted" }), {
        welcome: "unsupported",
        rows: [],
    });
    assert.equal(unavailable({ kind: "missing" }).welcome, "runtime");
    assert.equal(
        unavailable({ kind: "tooOld", path: "C:/old.exe", version: "1.2.0", fromSetting: false })
            .welcome,
        "runtime",
    );
    assert.equal(
        unavailable({ kind: "tooOld", path: "C:/old.exe", version: "1.2.0", fromSetting: true })
            .welcome,
        "runtimeSetting",
    );
});

test("signed out comes before no target", () => {
    assert.deepEqual(describeCoverageView(input({ auth: { kind: "signedOut" }, targets: [] })), {
        welcome: "signedOut",
        rows: [],
    });
});

test("signed in, with a token, or unsure, and no target, asks for one", () => {
    for (const auth of [
        { kind: "signedIn" } as const,
        { kind: "token" } as const,
        { kind: "error", message: "whoami failed" } as const,
    ]) {
        assert.equal(describeCoverageView(input({ auth, targets: [] })).welcome, "noTarget");
    }
});

test("ready shows the target to run, and which account and covdbg run it", () => {
    const view = describeCoverageView(input());

    assert.equal(view.welcome, undefined);
    assert.deepEqual(labels(view.rows), [
        "Ready: build/Debug/test_app.exe",
        "Signed in as dev@example.com",
    ]);
    assert.equal(view.rows[0].contextValue, "ready");
    assert.equal(view.rows[1].description, "covdbg 1.3.0 (PATH)");
});

test("several targets are counted", () => {
    const view = describeCoverageView(input({ targets: ["a.exe", "b.exe"] }));
    assert.equal(view.rows[0].label, "Ready: 2 test executables");
});

test("a project token is named, with no sign-in offered", () => {
    const view = describeCoverageView(input({ auth: { kind: "token" } }));
    const account = view.rows.find((row) => row.id === "account");

    assert.equal(account?.label, "Using project token (COVDBG_PROJECT_TOKEN)");
    assert.equal(account?.command, undefined);
});

test("signing in shows the code with its actions, and nothing to run yet", () => {
    const view = describeCoverageView(
        input({
            auth: { kind: "signingIn", url: "https://app.covdbg.com/device?code=AB", code: "AB" },
        }),
    );

    assert.deepEqual(labels(view.rows), ["Confirm code AB in your browser."]);
    assert.equal(view.rows[0].contextValue, "signingIn");
});

test("still checking shows that, not a welcome", () => {
    const view = describeCoverageView(input({ auth: { kind: "unknown" }, targets: [] }));

    assert.equal(view.welcome, undefined);
    assert.deepEqual(labels(view.rows), ["Checking covdbg…"]);
});

test("results show the summary, the lowest files and the account", () => {
    const view = describeCoverageView(input({ coverage: [LOADED] }));

    assert.deepEqual(labels(view.rows), [
        "60.5% lines · 3 files · 2 min ago",
        "Lowest coverage",
        "Signed in as dev@example.com",
    ]);
    assert.equal(view.rows[0].command, "covdbg.showReport");
    const lowest = view.rows[1].children ?? [];
    assert.deepEqual(labels(lowest), ["parser.cpp", "main.cpp", "Show all"]);
    assert.equal(lowest[0].filePath, "C:/app/src/parser.cpp");
    assert.equal(lowest[2].command, "covdbg.browseFiles");
});

test("results stay on screen when signed out or covdbg is gone", () => {
    const signedOut = describeCoverageView(
        input({ auth: { kind: "signedOut" }, coverage: [LOADED] }),
    );
    const account = signedOut.rows[signedOut.rows.length - 1];
    assert.equal(signedOut.welcome, undefined);
    assert.equal(account.label, "Not signed in");
    assert.equal(account.command, "covdbg.signIn");

    const untrusted = describeCoverageView(
        input({
            auth: { kind: "unavailable", runtime: { kind: "unsupported", reason: "untrusted" } },
            coverage: [LOADED],
        }),
    );
    assert.equal(untrusted.welcome, undefined);
    assert.equal(untrusted.rows[0].label, "60.5% lines · 3 files · 2 min ago");
});

test("a multi-root summary names its folder", () => {
    const view = describeCoverageView(
        input({
            multiRoot: true,
            coverage: [LOADED, { ...LOADED, folderName: "lib", mtime: NOW - 3 * 3_600_000 }],
        }),
    );

    assert.deepEqual(labels(view.rows).slice(0, 2), [
        "app: 60.5% lines · 3 files · 2 min ago",
        "lib: 60.5% lines · 3 files · 3 h ago",
    ]);
});

test("a .covdb that showed nothing is a problem row, not a welcome", () => {
    const view = describeCoverageView(
        input({
            auth: { kind: "signedOut" },
            coverage: [
                { folderName: "app", mtime: 0, files: [], problem: "coverage.covdb is empty" },
            ],
        }),
    );

    assert.equal(view.welcome, undefined);
    assert.equal(view.rows[0].label, "coverage.covdb is empty");
    assert.equal(view.rows[0].icon, "warning");
});

test("the last run's notice is a row with its action", () => {
    const withNotice = (notice: CoverageViewInput["notice"]) =>
        describeCoverageView(input({ coverage: [LOADED], notice })).rows.find(
            (row) => row.id === "notice",
        );

    assert.equal(withNotice({ kind: "gated", message: "gated" })?.command, undefined);
    assert.equal(
        withNotice({ kind: "lockSet", message: "now locked to x", action: "openProfile" })?.url,
        "https://app.covdbg.com/profile",
    );
    assert.equal(
        withNotice({ kind: "sessionInvalid", message: "ended", action: "signIn" })?.command,
        "covdbg.signIn",
    );
});

test("row ids stay the same from one refresh to the next, so expanded rows stay expanded", () => {
    const ids = (view: ReturnType<typeof describeCoverageView>) =>
        view.rows.flatMap((row) => [row.id, ...(row.children ?? []).map((child) => child.id)]);

    const before = describeCoverageView(input({ coverage: [LOADED] }));
    const after = describeCoverageView(input({ coverage: [LOADED], now: NOW + 3_600_000 }));

    assert.deepEqual(ids(after), ids(before));
});

test("ages read naturally", () => {
    assert.equal(formatAge(10_000), "just now");
    assert.equal(formatAge(5 * 60_000), "5 min ago");
    assert.equal(formatAge(2 * 3_600_000), "2 h ago");
    assert.equal(formatAge(24 * 3_600_000), "1 day ago");
    assert.equal(formatAge(3 * 24 * 3_600_000), "3 days ago");
});
