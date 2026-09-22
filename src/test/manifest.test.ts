import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

type PackageManifest = {
    activationEvents?: string[];
    devDependencies?: Record<string, string>;
    engines?: {
        vscode?: string;
    };
    contributes?: {
        languageModelTools?: unknown;
        mcpServerDefinitionProviders?: { id: string; label: string }[];
    };
};

function readPackageManifest(): PackageManifest {
    return JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as PackageManifest;
}

/**
 * Read out of the source rather than imported: the provider module imports vscode, which does not
 * exist under node:test.
 */
function readProviderConstant(name: string): string | undefined {
    const source = fs.readFileSync(
        path.resolve(process.cwd(), "src/mcp/serverDefinitionProvider.ts"),
        "utf8",
    );
    return new RegExp(`${name} = "([^"]+)"`).exec(source)?.[1];
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

test("manifest contributes exactly one MCP server definition provider", () => {
    const providers = readPackageManifest().contributes?.mcpServerDefinitionProviders;

    assert.ok(providers, "expected contributes.mcpServerDefinitionProviders");
    assert.equal(providers.length, 1, "decision D-F: one server per window, not one per folder");
});

test("the contributed provider id matches the id the extension registers", () => {
    // There is no JSON schema for this contribution point in @types/vscode, so a typo in either
    // place is silent at build time and shows up only as a provider that never runs.
    const contributed = readPackageManifest().contributes?.mcpServerDefinitionProviders?.[0];
    const registered = readProviderConstant("COVDBG_MCP_PROVIDER_ID");

    assert.ok(registered, "could not find COVDBG_MCP_PROVIDER_ID in the provider source");
    assert.equal(
        contributed?.id,
        registered,
        "package.json and registerMcpServerDefinitionProvider must use the same id",
    );
});

test("the contributed provider label matches the label the provider uses", () => {
    const contributed = readPackageManifest().contributes?.mcpServerDefinitionProviders?.[0];

    assert.equal(contributed?.label, readProviderConstant("COVDBG_MCP_SERVER_LABEL"));
});

test("asking for the MCP collection activates the extension in any window", () => {
    // Without it the server is missing from MCP: List Servers wherever no workspaceContains
    // trigger matches, because the provider is registered only during activation.
    const id = readProviderConstant("COVDBG_MCP_PROVIDER_ID");

    assert.ok(readPackageManifest().activationEvents?.includes(`onMcpCollection:${id}`));
});

test("the language-model tool contribution is gone", () => {
    assert.equal(readPackageManifest().contributes?.languageModelTools, undefined);
});
