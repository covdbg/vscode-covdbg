import test from "node:test";
import assert from "node:assert/strict";
import { getKnownInstallPaths } from "../runner/installPaths";

test("known install paths include covdbg executable candidates", () => {
    const candidates = getKnownInstallPaths();
    assert.ok(candidates.length >= 2);
    for (const candidate of candidates) {
        assert.ok(candidate.toLowerCase().endsWith("covdbg.exe"));
    }
});
