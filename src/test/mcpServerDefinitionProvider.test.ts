import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

type PackageManifest = {
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
 * The id must match the one passed to registerMcpServerDefinitionProvider. There is no JSON schema
 * for this contribution point in @types/vscode, so a typo in either place is silent at build time
 * and shows up only as a provider that never runs. Read out of the source rather than imported:
 * the provider module imports vscode, which does not exist under node:test.
 */
function readProviderIdFromSource(): string | undefined {
    const source = fs.readFileSync(
        path.resolve(process.cwd(), "src/mcp/serverDefinitionProvider.ts"),
        "utf8",
    );
    return /COVDBG_MCP_PROVIDER_ID = "([^"]+)"/.exec(source)?.[1];
}

function readProviderLabelFromSource(): string | undefined {
    const source = fs.readFileSync(
        path.resolve(process.cwd(), "src/mcp/serverDefinitionProvider.ts"),
        "utf8",
    );
    return /COVDBG_MCP_SERVER_LABEL = "([^"]+)"/.exec(source)?.[1];
}

test("manifest contributes exactly one MCP server definition provider", () => {
    const providers = readPackageManifest().contributes?.mcpServerDefinitionProviders;

    assert.ok(providers, "expected contributes.mcpServerDefinitionProviders");
    assert.equal(providers.length, 1, "decision D-F: one server per window, not one per folder");
});

test("the contributed provider id matches the id the extension registers", () => {
    const contributed = readPackageManifest().contributes?.mcpServerDefinitionProviders?.[0];
    const registered = readProviderIdFromSource();

    assert.ok(registered, "could not find COVDBG_MCP_PROVIDER_ID in the provider source");
    assert.equal(
        contributed?.id,
        registered,
        "package.json and registerMcpServerDefinitionProvider must use the same id",
    );
});

test("the contributed provider label matches the label the provider uses", () => {
    const contributed = readPackageManifest().contributes?.mcpServerDefinitionProviders?.[0];

    assert.equal(contributed?.label, readProviderLabelFromSource());
});

test("the language-model tool contribution is gone", () => {
    assert.equal(readPackageManifest().contributes?.languageModelTools, undefined);
});
