import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
    normalizeExecutablePathsInput,
    RUN_TEST_WITH_COVERAGE_TOOL_NAME,
} from "../tools/runTestWithCoverageModel";

type ContributedTool = {
    name: string;
    inputSchema?: {
        properties?: Record<string, unknown>;
    };
};

test("tool manifest contributes the three covdbg LM tools", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
        contributes?: {
            languageModelTools?: ContributedTool[];
        };
    };

    const tools = manifest.contributes?.languageModelTools ?? [];
    const toolNames = tools.map((tool) => tool.name).sort();

    assert.deepEqual(toolNames, [
        "exploreUncoveredFiles_covdbg",
        "getUncoveredCode_covdbg",
        RUN_TEST_WITH_COVERAGE_TOOL_NAME,
    ]);

    const runTool = tools.find((tool) => tool.name === RUN_TEST_WITH_COVERAGE_TOOL_NAME);
    const exploreTool = tools.find(
        (tool) => tool.name === "exploreUncoveredFiles_covdbg",
    );
    const uncoveredTool = tools.find(
        (tool) => tool.name === "getUncoveredCode_covdbg",
    );

    assert.ok(runTool?.inputSchema?.properties?.executablePaths);
    assert.ok(runTool?.inputSchema?.properties?.executablePath);
    assert.ok(exploreTool?.inputSchema?.properties?.limit);
    assert.ok(exploreTool?.inputSchema?.properties?.maxCoveragePercent);
    assert.ok(uncoveredTool?.inputSchema?.properties?.filePath);
});

test("normalizeExecutablePathsInput prefers the array input and trims values", () => {
    assert.deepEqual(
        normalizeExecutablePathsInput({
            executablePaths: [" build\\suite1.exe ", "", "build\\suite2.exe"],
            executablePath: "build\\fallback.exe",
        }),
        ["build\\suite1.exe", "build\\suite2.exe"],
    );
});

test("normalizeExecutablePathsInput falls back to the deprecated singular field", () => {
    assert.deepEqual(
        normalizeExecutablePathsInput({
            executablePath: " build\\suite.exe ",
        }),
        ["build\\suite.exe"],
    );
    assert.deepEqual(normalizeExecutablePathsInput({}), []);
});
