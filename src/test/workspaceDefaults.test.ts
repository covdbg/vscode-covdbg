import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
    DEFAULT_BINARY_DISCOVERY_EXCLUDE_PATTERN,
    DEFAULT_BINARY_DISCOVERY_PATTERN,
    buildExecutableDiscoveryExcludePattern,
} from "../runner/discoveryPatterns";

test("buildExecutableDiscoveryExcludePattern returns builtin excludes by default", () => {
    assert.equal(
        buildExecutableDiscoveryExcludePattern(""),
        "**/{.git,node_modules,.vscode,assets}/**",
    );
});

test("buildExecutableDiscoveryExcludePattern combines builtin and user excludes", () => {
    assert.equal(
        buildExecutableDiscoveryExcludePattern("**/copied-tests/**"),
        "{**/{.git,node_modules,.vscode,assets}/**,**/copied-tests/**}",
    );
});

/** Whether the default discovery settings pick this workspace-relative path. */
function discovered(relativePath: string): boolean {
    return (
        path.posix.matchesGlob(relativePath, DEFAULT_BINARY_DISCOVERY_PATTERN) &&
        !path.posix.matchesGlob(relativePath, DEFAULT_BINARY_DISCOVERY_EXCLUDE_PATTERN)
    );
}

test("default discovery finds CMake, MSBuild and CLion debug test executables", () => {
    for (const found of [
        "build/Debug/test_app.exe",
        "out/build/x64-Debug/tests/UnitTests.exe",
        "x64/Debug/ParserTests.exe",
        "cmake-build-debug/tests/app_test.exe",
    ]) {
        assert.ok(discovered(found), found);
    }
});

test("default discovery skips optimized builds and executables that are not tests", () => {
    for (const skipped of [
        "build/Release/test_app.exe",
        "x64/RelWithDebInfo/ParserTests.exe",
        "build/Debug/app.exe",
        "tools/test_runner.exe",
    ]) {
        assert.ok(!discovered(skipped), skipped);
    }
});

test("the manifest's discovery defaults are the ones the settings fall back to", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    );
    const properties = manifest.contributes.configuration.properties;

    assert.equal(
        properties["covdbg.runner.binaryDiscoveryPattern"].default,
        DEFAULT_BINARY_DISCOVERY_PATTERN,
    );
    assert.equal(
        properties["covdbg.runner.binaryDiscoveryExcludePattern"].default,
        DEFAULT_BINARY_DISCOVERY_EXCLUDE_PATTERN,
    );
});
