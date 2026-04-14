const fs = require("fs/promises");
const path = require("path");

async function main() {
    const releaseTag = process.argv[2];
    if (!releaseTag) {
        throw new Error("Expected release tag argument, for example v0.3.0.");
    }

    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    const packageVersion = packageJson.version;
    if (typeof packageVersion !== "string" || packageVersion.trim().length === 0) {
        throw new Error("package.json does not contain a valid version.");
    }

    const expectedTag = `v${packageVersion}`;
    if (releaseTag !== expectedTag) {
        throw new Error(
            `Release tag ${releaseTag} does not match package.json version ${packageVersion}. Expected ${expectedTag}.`,
        );
    }

    console.log(`Release tag ${releaseTag} matches package.json version ${packageVersion}.`);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
