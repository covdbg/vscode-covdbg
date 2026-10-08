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
        commands?: { command: string }[];
        views?: Record<string, { id: string; type?: string }[]>;
        viewsWelcome?: { view: string; when?: string }[];
        languageModelTools?: unknown;
        mcpServerDefinitionProviders?: { id: string; label: string }[];
        menus?: Record<string, { command: string; when?: string }[]>;
        configuration?: { properties?: Record<string, unknown> };
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

test("the extension activates only in C++ or covdbg workspaces, not at every startup", () => {
    const events = readPackageManifest().activationEvents ?? [];

    assert.ok(!events.includes("onStartupFinished"));
    for (const glob of [
        "**/.covdbg.yaml",
        "**/*.covdb",
        "**/CMakeLists.txt",
        "**/*.sln",
        "**/*.vcxproj",
    ]) {
        assert.ok(events.includes(`workspaceContains:${glob}`), glob);
    }
});

test("a run's message in Test Results offers the log", () => {
    // The run no longer opens the Output panel on its own, so this button is the way to it.
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/extension.ts"), "utf8");
    const contextValue = /message\.contextValue = "([^"]+)"/.exec(source)?.[1];
    const menu = readPackageManifest().contributes?.menus?.["testing/message/content"] ?? [];

    assert.ok(contextValue, "could not find the TestMessage contextValue in extension.ts");
    assert.ok(
        menu.some(
            (entry) =>
                entry.command === "covdbg.showOutput" &&
                entry.when === `testMessage == ${contextValue}`,
        ),
    );
});

/** Every non-test source file, concatenated. */
function readSources(): string {
    const root = path.resolve(process.cwd(), "src");
    const files = fs.readdirSync(root, { recursive: true, encoding: "utf8" });
    return files
        .filter((file) => file.endsWith(".ts") && !file.startsWith("test"))
        .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
        .join("\n");
}

test("contributed commands are exactly the registered ones", () => {
    const contributed = (readPackageManifest().contributes?.commands ?? []).map((c) => c.command);
    const registered = [...readSources().matchAll(/registerCommand\(\s*"(covdbg\.[^"]+)"/g)].map(
        (match) => match[1],
    );

    assert.deepEqual([...contributed].sort(), [...registered].sort());
});

test("the Coverage view keeps its id and is a native tree", () => {
    // Keeping covdbg.homeView keeps where users put the view.
    const views = readPackageManifest().contributes?.views?.["covdbg-sidebar"] ?? [];

    assert.deepEqual(
        views.map((view) => [view.id, view.type]),
        [["covdbg.homeView", undefined]],
    );
});

test("every context key a welcome state waits for is set somewhere", () => {
    const sources = readSources();
    const welcome = readPackageManifest().contributes?.viewsWelcome ?? [];
    const keys = new Set(welcome.flatMap((entry) => entry.when?.match(/covdbg\.\w+/g) ?? []));

    assert.ok(keys.size > 0);
    for (const key of keys) {
        const pattern = `"setContext",\\s*"${key.replace(".", "\\.")}"`;
        assert.match(sources, new RegExp(pattern), key);
    }
});

test("the settings covdbg 1.3 refuses are gone", () => {
    const properties = readPackageManifest().contributes?.configuration?.properties ?? {};

    for (const key of ["covdbg.runner.appDataPath", "covdbg.runner.licenseServerUrl"]) {
        assert.ok(!(key in properties), key);
    }
});
