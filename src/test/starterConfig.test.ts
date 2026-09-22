import test from "node:test";
import assert from "node:assert/strict";
import { load } from "js-yaml";
import { buildStarterConfig } from "../runner/starterConfig";

type StarterConfig = {
    version: number;
    coverage: {
        default: {
            files: { include?: string[]; exclude: string[] };
            functions: { include: string[]; exclude: string[] };
        };
    };
};

const config = load(buildStarterConfig()) as StarterConfig;

test("the starter config is version 1, rooted at the folder it is written to", () => {
    assert.equal(config.version, 1);
    assert.equal((config as Record<string, unknown>).source_root, ".");
});

test("the starter config names no source files, so every file the PDB names counts", () => {
    // covdbg treats a missing files.include as everything; a project's src/** would not fit others.
    assert.equal(config.coverage.default.files.include, undefined);
    assert.ok(!buildStarterConfig().includes("Tests.cpp"));
});

test("the starter config leaves out the SDK, the MSVC runtime and compiler functions", () => {
    const { files, functions } = config.coverage.default;

    for (const pattern of [
        "**/Windows Kits/**",
        "**/VC/Tools/MSVC/**",
        "**/stl/inc/**",
        // The PDB names vcruntime's headers by a relative path none of the others match.
        "**/VCCRT/**",
    ]) {
        assert.ok(files.exclude.includes(pattern), pattern);
    }
    assert.deepEqual(functions.include, ["*"]);
    for (const pattern of ["__scrt_*", "_RTC_*", "__security_*"]) {
        assert.ok(functions.exclude.includes(pattern), pattern);
    }
});
