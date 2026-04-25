const fs = require("node:fs");
const path = require("node:path");

const mode = process.argv.includes("--write") ? "write" : "check";
const repoRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}\n`);
}

function getExpectedVscodeVersion(packageJson) {
    const version = packageJson.devDependencies?.["@types/vscode"];

    if (!version) {
        throw new Error("package.json is missing devDependencies.@types/vscode");
    }

    return version;
}

function syncVscodeEngineVersions() {
    const packageJson = readJson(packageJsonPath);
    const packageLock = readJson(packageLockPath);
    const expectedVersion = getExpectedVscodeVersion(packageJson);
    const packageLockRoot = packageLock.packages?.[""];

    if (!packageLockRoot) {
        throw new Error("package-lock.json is missing packages[''] root metadata");
    }

    const currentManifestEngine = packageJson.engines?.vscode;
    const currentLockEngine = packageLockRoot.engines?.vscode;
    const needsPackageJsonUpdate = currentManifestEngine !== expectedVersion;
    const needsPackageLockUpdate = currentLockEngine !== expectedVersion;

    if (!needsPackageJsonUpdate && !needsPackageLockUpdate) {
        console.log(`VS Code engine already aligned with @types/vscode (${expectedVersion}).`);
        return;
    }

    if (mode !== "write") {
        throw new Error(
            `VS Code engine mismatch: expected ${expectedVersion}, package.json has ${currentManifestEngine ?? "<missing>"}, package-lock.json has ${currentLockEngine ?? "<missing>"}. Run npm run sync:vscode-engine.`,
        );
    }

    packageJson.engines = {
        ...(packageJson.engines ?? {}),
        vscode: expectedVersion,
    };
    packageLockRoot.engines = {
        ...(packageLockRoot.engines ?? {}),
        vscode: expectedVersion,
    };

    writeJson(packageJsonPath, packageJson);
    writeJson(packageLockPath, packageLock);
    console.log(`Updated package.json and package-lock.json to VS Code engine ${expectedVersion}.`);
}

try {
    syncVscodeEngineVersions();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
