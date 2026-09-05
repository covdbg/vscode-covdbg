import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

type PackageManifest = {
    devDependencies?: Record<string, string>;
    engines?: {
        vscode?: string;
    };
};

function readPackageManifest(): PackageManifest {
    return JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as PackageManifest;
}

test("manifest keeps engines.vscode aligned with @types/vscode", () => {
    const manifest = readPackageManifest();
    const vscodeTypesVersion = manifest.devDependencies?.["@types/vscode"];

    assert.ok(vscodeTypesVersion, "expected @types/vscode devDependency");
    assert.equal(
        manifest.engines?.vscode,
        vscodeTypesVersion,
        "engines.vscode must match @types/vscode so Dependabot PRs fail fast on API floor drift",
    );
});
