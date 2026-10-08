import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Whether covdbg would find no repository to name a run by from this folder, the one it resolves
 * `source_root: "."` to: covdbg reads the `origin` remote from the folder's own `.git`, and without
 * one names the repository by its first commit. With neither, the license service refuses the run.
 * A git that cannot be started is not a reason to nag.
 */
export async function needsRepositoryHint(folderPath: string): Promise<boolean> {
    try {
        const config = await fs.readFile(path.join(folderPath, ".git", "config"), "utf8");
        if (/^\s*\[remote\s+["']origin["']\]/m.test(config)) {
            return false;
        }
    } catch {
        // No .git directory here: a worktree, a folder inside a checkout, or no repository at all.
    }

    return new Promise((resolve) => {
        execFile(
            "git",
            ["-C", folderPath, "rev-parse", "--verify", "--quiet", "HEAD"],
            { windowsHide: true },
            (error) => {
                const notStarted =
                    error !== null && typeof (error as NodeJS.ErrnoException).code === "string";
                resolve(error !== null && !notStarted);
            },
        );
    });
}
