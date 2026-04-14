import test from "node:test";
import assert from "node:assert/strict";
import {
    COVDBG_EXIT_NO_FUNCTIONS_TO_TRACK,
    getCovdbgRunFailureMessage,
} from "../runner/exitCodes";

test("getCovdbgRunFailureMessage explains the coverage-filter exit code", () => {
    assert.equal(
        getCovdbgRunFailureMessage(COVDBG_EXIT_NO_FUNCTIONS_TO_TRACK),
        "No functions passed the coverage filter. Adjust the file or function filters in .covdbg.yaml and try again.",
    );
});

test("getCovdbgRunFailureMessage falls back to the numeric exit code", () => {
    assert.equal(getCovdbgRunFailureMessage(17), "covdbg exited with code 17");
    assert.equal(getCovdbgRunFailureMessage(null), "covdbg exited with code null");
});