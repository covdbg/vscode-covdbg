import * as path from "path";

const COVDBG_EXE = "covdbg.exe";

export function getKnownInstallPaths(): string[] {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFiles86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    const candidates = [
        path.join(programFiles, "Liasoft", "covdbg", COVDBG_EXE),
        path.join(programFiles86, "Liasoft", "covdbg", COVDBG_EXE),
    ];
    if (localAppData) {
        candidates.push(path.join(localAppData, "Programs", "covdbg", COVDBG_EXE));
    }
    return candidates;
}
