const { execFileSync } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const ZIP_PATH = path.join(__dirname, "..", "assets", "portable", "covdbg-portable.zip");

async function main() {
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const expected = JSON.parse(await fs.readFile(packageJsonPath, "utf8")).covdbgBundledVersion;
    if (typeof expected !== "string" || expected.length === 0) {
        throw new Error("package.json does not contain covdbgBundledVersion.");
    }

    const extractPath = await fs.mkdtemp(path.join(os.tmpdir(), "covdbg-bundled-"));
    try {
        execFileSync("powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${extractPath}' -Force`,
        ]);
        const exe = (await fs.readdir(extractPath, { recursive: true })).find(
            (entry) => path.basename(entry).toLowerCase() === "covdbg.exe",
        );
        if (!exe) {
            throw new Error(`${ZIP_PATH} does not contain covdbg.exe.`);
        }
        const stdout = execFileSync(path.join(extractPath, exe), ["--version"], {
            encoding: "utf8",
        });
        const actual = /^covdbg\s+(\S+)/m.exec(stdout)?.[1];
        if (actual !== expected) {
            throw new Error(
                `The bundled covdbg reports ${actual ?? "no version"}, but covdbgBundledVersion is ${expected}.`,
            );
        }
        console.log(`The bundled covdbg reports ${actual}, as expected.`);
    } finally {
        await fs.rm(extractPath, { recursive: true, force: true });
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
