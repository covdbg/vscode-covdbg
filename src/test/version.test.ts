import test from "node:test";
import assert from "node:assert/strict";
import { meetsMinimumVersion, parseCovdbgVersion } from "../runner/version";

test("parseCovdbgVersion reads what covdbg --version prints", () => {
    assert.equal(parseCovdbgVersion("covdbg 1.3.0\r\n"), "1.3.0");
    assert.equal(parseCovdbgVersion("covdbg 0.0.1-debug\n"), "0.0.1-debug");
    assert.equal(parseCovdbgVersion("Usage: covdbg [options]\n"), undefined);
    assert.equal(parseCovdbgVersion(""), undefined);
});

test("meetsMinimumVersion lets 1.3.0 and newer through", () => {
    assert.equal(meetsMinimumVersion("1.3.0"), true);
    assert.equal(meetsMinimumVersion("1.3.1"), true);
    assert.equal(meetsMinimumVersion("1.10.0"), true);
    assert.equal(meetsMinimumVersion("2.0.0"), true);
});

test("meetsMinimumVersion rejects older covdbg, the local debug build included", () => {
    assert.equal(meetsMinimumVersion("1.2.9"), false);
    assert.equal(meetsMinimumVersion("0.9.0"), false);
    assert.equal(meetsMinimumVersion("0.0.1-debug"), false);
});
