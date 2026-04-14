import test from "node:test";
import assert from "node:assert/strict";
import { findBestCoverageKey } from "../coverage/coverageKeyMatcher";

test("findBestCoverageKey prefers exact path matches", () => {
    const result = findBestCoverageKey(
        "D:\\Code\\covdbg\\quick-start\\src\\main.cpp",
        [
            "D:\\Code\\covdbg\\quick-start\\src\\main.cpp",
            "D:\\Code\\covdbg\\quick-start-2\\src\\main.cpp",
        ],
        "D:\\Code\\covdbg\\quick-start",
    );

    assert.equal(result, "D:\\Code\\covdbg\\quick-start\\src\\main.cpp");
});

test("findBestCoverageKey rejects ambiguous suffix-only matches", () => {
    const result = findBestCoverageKey(
        "D:\\Code\\covdbg\\workspace\\src\\main.cpp",
        [
            "D:\\Code\\covdbg\\quick-start\\src\\main.cpp",
            "D:\\Code\\covdbg\\quick-start-2\\src\\main.cpp",
        ],
        undefined,
    );

    assert.equal(result, undefined);
});

test("findBestCoverageKey uses workspace-relative uniqueness", () => {
    const result = findBestCoverageKey(
        "D:\\Code\\covdbg\\quick-start\\src\\main.cpp",
        [
            "src\\main.cpp",
            "src\\other.cpp",
        ],
        "D:\\Code\\covdbg\\quick-start",
    );

    assert.equal(result, "src\\main.cpp");
});
