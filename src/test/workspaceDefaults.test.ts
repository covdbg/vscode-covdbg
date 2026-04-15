import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutableDiscoveryExcludePattern } from '../runner/discoveryPatterns';

test('buildExecutableDiscoveryExcludePattern returns builtin excludes by default', () => {
    assert.equal(
        buildExecutableDiscoveryExcludePattern(''),
        '**/{.git,node_modules,.vscode,assets}/**',
    );
});

test('buildExecutableDiscoveryExcludePattern combines builtin and user excludes', () => {
    assert.equal(
        buildExecutableDiscoveryExcludePattern('**/copied-tests/**'),
        '{**/{.git,node_modules,.vscode,assets}/**,**/copied-tests/**}',
    );
});
