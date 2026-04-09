import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCovdbgArguments, ensureArrayOfStrings } from '../runner/runnerArgs';
import { deriveCoverageBatchOutputPath } from '../runner/outputPaths';

test('buildCovdbgArguments builds expected covdbg CLI shape', () => {
    const args = buildCovdbgArguments({
        workspaceRoot: 'C:\\repo',
        configPath: 'C:\\repo\\.covdbg.yaml',
        configuredOutputPath: 'C:\\repo\\.covdbg\\coverage.covdb',
        outputPath: 'C:\\repo\\.covdbg\\coverage.covdb',
        appDataPath: 'C:\\repo\\.covdbg',
        workingDirectory: 'C:\\repo',
    }, 'C:\\repo\\build\\tests.exe', ['--gtest_filter=Suite.*']);

    assert.deepEqual(args, [
        '--appdata', 'C:\\repo\\.covdbg',
        '--config', 'C:\\repo\\.covdbg.yaml',
        '--output', 'C:\\repo\\.covdbg\\coverage.covdb',
        'C:\\repo\\build\\tests.exe',
        '--gtest_filter=Suite.*',
    ]);
});

test('buildCovdbgArguments inserts covdbg CLI flags before target executable', () => {
    const args = buildCovdbgArguments({
        workspaceRoot: 'C:\\repo',
        configPath: undefined,
        configuredOutputPath: 'C:\\repo\\.covdbg\\coverage.covdb',
        outputPath: 'C:\\repo\\.covdbg\\coverage.covdb',
        appDataPath: 'C:\\repo\\.covdbg',
        workingDirectory: 'C:\\repo',
    }, 'C:\\repo\\build\\tests.exe', ['--gtest_filter=Suite.*'], ['--demo', '--plugin-name', 'vscode', '--plugin-ver', '0.3.0']);

    assert.deepEqual(args, [
        '--appdata', 'C:\\repo\\.covdbg',
        '--output', 'C:\\repo\\.covdbg\\coverage.covdb',
        '--demo',
        '--plugin-name', 'vscode',
        '--plugin-ver', '0.3.0',
        'C:\\repo\\build\\tests.exe',
        '--gtest_filter=Suite.*',
    ]);
});

test('ensureArrayOfStrings filters non-strings and empty values', () => {
    const input: unknown = ['foo', ' ', 1, null, 'bar'];
    assert.deepEqual(ensureArrayOfStrings(input), ['foo', 'bar']);
});

test('deriveCoverageBatchOutputPath uses executable basename in the configured output directory', () => {
    assert.equal(
        deriveCoverageBatchOutputPath(
            'C:\\repo\\.covdbg\\coverage.covdb',
            'C:\\repo\\build\\suite.tests.exe',
        ),
        'C:\\repo\\.covdbg\\suite.tests.covdb',
    );
});

test('deriveCoverageBatchOutputPath ignores the configured output basename for intermediates', () => {
    assert.equal(
        deriveCoverageBatchOutputPath(
            'C:\\repo\\.covdbg\\nightly.covdb',
            'C:\\repo\\build\\suite.tests.exe',
        ),
        'C:\\repo\\.covdbg\\suite.tests.covdb',
    );
});

