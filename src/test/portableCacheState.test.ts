import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    portableArchiveStampMatches,
    readPortableArchiveStamp,
    writePortableArchiveStamp,
} from '../runner/portableCacheState';

test('portable archive stamp round-trips through disk', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'covdbg-portable-state-'));
    const statePath = path.join(tempDir, 'bundled-state.json');

    const expected = { size: 1234, mtimeMs: 5678 };
    await writePortableArchiveStamp(statePath, expected);

    const actual = await readPortableArchiveStamp(statePath);
    assert.deepEqual(actual, expected);

    await fs.rm(tempDir, { recursive: true, force: true });
});

test('portable archive stamp comparison rejects stale or missing state', () => {
    const expected = { size: 1234, mtimeMs: 5678 };

    assert.equal(portableArchiveStampMatches(expected, expected), true);
    assert.equal(portableArchiveStampMatches(expected, { size: 1234, mtimeMs: 9999 }), false);
    assert.equal(portableArchiveStampMatches(expected, { size: 9999, mtimeMs: 5678 }), false);
    assert.equal(portableArchiveStampMatches(expected, undefined), false);
});