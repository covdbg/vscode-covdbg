import test from "node:test";
import assert from "node:assert/strict";
import { isCovdbgRunnable } from "../mcp/preflight";

const runnable = { platform: "win32", isTrusted: true, remoteName: undefined };

test("isCovdbgRunnable accepts a trusted local Windows window", () => {
    assert.equal(isCovdbgRunnable(runnable), true);
});

test("isCovdbgRunnable refuses a non-Windows window", () => {
    assert.equal(isCovdbgRunnable({ ...runnable, platform: "linux" }), false);
    assert.equal(isCovdbgRunnable({ ...runnable, platform: "darwin" }), false);
});

test("isCovdbgRunnable refuses an untrusted workspace", () => {
    // package.json's capabilities.untrustedWorkspaces promises that running coverage binaries
    // requires trust. Offering the server here would break that promise, not just fail later.
    assert.equal(isCovdbgRunnable({ ...runnable, isTrusted: false }), false);
});

test("isCovdbgRunnable refuses a remote window", () => {
    assert.equal(isCovdbgRunnable({ ...runnable, remoteName: "wsl" }), false);
    assert.equal(isCovdbgRunnable({ ...runnable, remoteName: "ssh-remote" }), false);
});

test("isCovdbgRunnable needs every condition, not just one", () => {
    assert.equal(
        isCovdbgRunnable({ platform: "linux", isTrusted: false, remoteName: "wsl" }),
        false,
    );
    assert.equal(isCovdbgRunnable({ ...runnable, platform: "win32", isTrusted: false }), false);
});
