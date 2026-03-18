import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCovdbgArguments, ensureArrayOfStrings } from '../runner/runnerArgs';

test('buildCovdbgArguments builds expected covdbg CLI shape', () => {
    const args = buildCovdbgArguments({
        workspaceRoot: 'C:\\repo',
        targetExecutablePath: 'C:\\repo\\build\\tests.exe',
        configPath: 'C:\\repo\\.covdbg.yaml',
        outputPath: 'C:\\repo\\.covdbg\\coverage.covdb',
        appDataPath: 'C:\\repo\\.covdbg',
        workingDirectory: 'C:\\repo',
    }, ['--gtest_filter=Suite.*']);

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
        targetExecutablePath: 'C:\\repo\\build\\tests.exe',
        configPath: undefined,
        outputPath: 'C:\\repo\\.covdbg\\coverage.covdb',
        appDataPath: 'C:\\repo\\.covdbg',
        workingDirectory: 'C:\\repo',
    }, ['--gtest_filter=Suite.*'], ['--demo', '--plugin-name', 'vscode', '--plugin-ver', '0.2.0']);

    assert.deepEqual(args, [
        '--appdata', 'C:\\repo\\.covdbg',
        '--output', 'C:\\repo\\.covdbg\\coverage.covdb',
        '--demo',
        '--plugin-name', 'vscode',
        '--plugin-ver', '0.2.0',
        'C:\\repo\\build\\tests.exe',
        '--gtest_filter=Suite.*',
    ]);
});

test('ensureArrayOfStrings filters non-strings and empty values', () => {
    const input: unknown = ['foo', ' ', 1, null, 'bar'];
    assert.deepEqual(ensureArrayOfStrings(input), ['foo', 'bar']);
});

