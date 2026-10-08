import { vscodeStub } from "./vscodeStub";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type * as vscode from "vscode";
import { getKnownInstallPaths } from "../runner/installPaths";
import {
    RuntimeCandidate,
    describeRuntimeProblem,
    getRuntimeCandidates,
    pickRuntime,
    resolveBundledPortable,
    resolveCovdbgRuntime,
} from "../runner/executableResolver";
import type { RunnerSettings } from "../runner/runnerTypes";

const context = {
    extensionUri: { fsPath: os.tmpdir() },
    globalStorageUri: { fsPath: os.tmpdir() },
} as unknown as vscode.ExtensionContext;

function settingsWith(executablePath = ""): RunnerSettings {
    return {
        executablePath,
        portableCachePath: "",
        binaryDiscoveryPattern: "",
        binaryDiscoveryExcludePattern: "",
        targetArgs: [],
        configPath: "",
        outputPath: "",
        workingDirectory: "",
        env: {},
    };
}

/** A candidate at `exePath`, recording in `located` that it was looked for. */
function candidate(
    source: RuntimeCandidate["source"],
    exePath: string | undefined,
    located: string[] = [],
): RuntimeCandidate {
    return {
        source,
        locate: async () => {
            located.push(source);
            return exePath;
        },
    };
}

const versions = new Map([
    ["old.exe", "0.0.1-debug"],
    ["new.exe", "1.3.0"],
    ["newer.exe", "1.4.2"],
]);
const probe = async (exePath: string) => versions.get(exePath);

test("known install paths include covdbg executable candidates", () => {
    const candidates = getKnownInstallPaths();
    assert.ok(candidates.length >= 2);
    for (const candidate of candidates) {
        assert.ok(candidate.toLowerCase().endsWith("covdbg.exe"));
    }
});

test("known install paths include the per-user Liasoft install", () => {
    const saved = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = "C:\\Users\\dev\\AppData\\Local";
    try {
        assert.ok(
            getKnownInstallPaths().includes(
                path.join(
                    "C:\\Users\\dev\\AppData\\Local",
                    "Programs",
                    "Liasoft",
                    "covdbg",
                    "covdbg.exe",
                ),
            ),
        );
    } finally {
        if (saved === undefined) {
            delete process.env.LOCALAPPDATA;
        } else {
            process.env.LOCALAPPDATA = saved;
        }
    }
});

test("covdbg is looked for in the setting, PATH, installs, the bundled copy, then the cache", () => {
    const sources = getRuntimeCandidates(context, settingsWith("covdbg.exe"), os.tmpdir()).map(
        (c) => c.source,
    );
    const installs = getKnownInstallPaths().map(() => "install");
    assert.deepEqual(sources, ["setting", "path", ...installs, "bundled", "cache"]);
});

test("without covdbg.executablePath there is no setting candidate", () => {
    const sources = getRuntimeCandidates(context, settingsWith(), os.tmpdir()).map((c) => c.source);
    assert.equal(sources[0], "path");
});

test("the first covdbg 1.3 or newer wins, and nothing after it is looked for", async () => {
    const located: string[] = [];
    const state = await pickRuntime(
        [
            candidate("path", undefined, located),
            candidate("install", "new.exe", located),
            candidate("bundled", "newer.exe", located),
        ],
        probe,
    );
    assert.deepEqual(state, { kind: "ok", path: "new.exe", version: "1.3.0", source: "install" });
    assert.deepEqual(located, ["path", "install"]);
});

test("a covdbg older than 1.3, such as the 0.0.1-debug build, is passed over", async () => {
    const state = await pickRuntime(
        [candidate("bundled", "old.exe"), candidate("cache", "newer.exe")],
        probe,
    );
    assert.deepEqual(state, { kind: "ok", path: "newer.exe", version: "1.4.2", source: "cache" });
});

test("a too-old covdbg.executablePath is reported, not replaced by another covdbg", async () => {
    const located: string[] = [];
    const state = await pickRuntime(
        [candidate("setting", "old.exe", located), candidate("path", "new.exe", located)],
        probe,
    );
    assert.deepEqual(state, {
        kind: "tooOld",
        path: "old.exe",
        version: "0.0.1-debug",
        fromSetting: true,
    });
    assert.deepEqual(located, ["setting"]);
});

test("when every covdbg found is too old the first one is reported", async () => {
    const state = await pickRuntime(
        [candidate("path", "old.exe"), candidate("bundled", "broken.exe")],
        probe,
    );
    assert.deepEqual(state, {
        kind: "tooOld",
        path: "old.exe",
        version: "0.0.1-debug",
        fromSetting: false,
    });
});

test("a covdbg that reports no version is not called too old", () => {
    const message = describeRuntimeProblem({
        kind: "tooOld",
        path: "broken.exe",
        fromSetting: false,
    });
    assert.match(message, /broken\.exe, but it did not report its version/);
});

test("when no covdbg is found at all the runtime is missing", async () => {
    const state = await pickRuntime([candidate("path", undefined)], probe);
    assert.deepEqual(state, { kind: "missing" });
});

test(
    "overlapping calls share one expansion of the bundled archive",
    { skip: process.platform !== "win32" && "the archive is expanded with PowerShell" },
    async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covdbg-resolver-"));
        const portableDir = path.join(dir, "extension", "assets", "portable");
        fs.mkdirSync(portableDir, { recursive: true });
        fs.writeFileSync(path.join(dir, "covdbg.exe"), "");
        execFileSync("powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-Command",
            `Compress-Archive -LiteralPath '${path.join(dir, "covdbg.exe")}' -DestinationPath '${path.join(portableDir, "covdbg-portable.zip")}'`,
        ]);
        const bundledContext = {
            extensionUri: { fsPath: path.join(dir, "extension") },
        } as unknown as vscode.ExtensionContext;
        const settings = { ...settingsWith(), portableCachePath: path.join(dir, "cache") };
        try {
            const first = resolveBundledPortable(bundledContext, settings);
            const second = resolveBundledPortable(bundledContext, settings);
            assert.equal(first, second);
            assert.equal(await first, path.join(dir, "cache", "bundled", "covdbg.exe"));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    },
);

test("an untrusted workspace resolves to unsupported without looking for covdbg", async () => {
    vscodeStub.workspace.isTrusted = false;
    try {
        const state = await resolveCovdbgRuntime(context, settingsWith(), os.tmpdir());
        assert.deepEqual(
            state,
            process.platform === "win32"
                ? { kind: "unsupported", reason: "untrusted" }
                : { kind: "unsupported", reason: "platform" },
        );
    } finally {
        vscodeStub.workspace.isTrusted = true;
    }
});
