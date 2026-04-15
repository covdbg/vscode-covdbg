import test from "node:test";
import assert from "node:assert/strict";
import {
    resolveAnalyzeInputsForTarget,
} from "../runner/analyzeInputs";

test("resolveAnalyzeInputsForTarget falls back to default analyze inputs", () => {
    const result = resolveAnalyzeInputsForTarget(
        {
            analyzeInputs: ["build/app.exe"],
            analyzeInputsByTarget: {},
        },
        "D:\\repo",
        "D:\\repo\\build\\suite.exe",
    );

    assert.deepEqual(result, ["D:\\repo\\build\\app.exe"]);
});

test("resolveAnalyzeInputsForTarget prefers exact target rules", () => {
    const result = resolveAnalyzeInputsForTarget(
        {
            analyzeInputs: ["build/default.exe"],
            analyzeInputsByTarget: {
                "build/ui-tests.exe": ["build/app-ui.exe"],
            },
        },
        "D:\\repo",
        "D:\\repo\\build\\ui-tests.exe",
    );

    assert.deepEqual(result, ["D:\\repo\\build\\app-ui.exe"]);
});

test("resolveAnalyzeInputsForTarget supports basename and glob target rules", () => {
    const basenameRule = resolveAnalyzeInputsForTarget(
        {
            analyzeInputs: [],
            analyzeInputsByTarget: {
                "ui-tests.exe": ["build/app-ui.exe"],
            },
        },
        "D:\\repo",
        "D:\\repo\\out\\Debug\\ui-tests.exe",
    );

    const globRule = resolveAnalyzeInputsForTarget(
        {
            analyzeInputs: [],
            analyzeInputsByTarget: {
                "**/integration-tests.exe": ["build/app.exe", "build/plugin-host.exe"],
            },
        },
        "D:\\repo",
        "D:\\repo\\build\\x64\\integration-tests.exe",
    );

    assert.deepEqual(basenameRule, ["D:\\repo\\build\\app-ui.exe"]);
    assert.deepEqual(globRule, [
        "D:\\repo\\build\\app.exe",
        "D:\\repo\\build\\plugin-host.exe",
    ]);
});

test("resolveAnalyzeInputsForTarget allows explicit target opt-out", () => {
    const result = resolveAnalyzeInputsForTarget(
        {
            analyzeInputs: ["build/app.exe"],
            analyzeInputsByTarget: {
                "build/unit-tests.exe": [],
            },
        },
        "D:\\repo",
        "D:\\repo\\build\\unit-tests.exe",
    );

    assert.deepEqual(result, []);
});
