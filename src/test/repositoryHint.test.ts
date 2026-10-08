import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { needsRepositoryHint } from "../runner/repositoryHint";

async function tempFolder(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "covdbg-hint-"));
}

test("a folder with an origin remote needs no hint", async () => {
    const folder = await tempFolder();
    await fs.mkdir(path.join(folder, ".git"));
    await fs.writeFile(
        path.join(folder, ".git", "config"),
        '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://example.com/app.git\n',
    );

    assert.equal(await needsRepositoryHint(folder), false);
});

test("a folder in no repository needs the hint", async () => {
    assert.equal(await needsRepositoryHint(await tempFolder()), true);
});
