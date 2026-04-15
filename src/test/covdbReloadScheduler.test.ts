import assert from "node:assert/strict";
import test from "node:test";
import { CovdbReloadScheduler } from "../coverage/covdbReloadScheduler";

test("CovdbReloadScheduler defers reloads while coverage execution is active", () => {
    const scheduler = new CovdbReloadScheduler();

    scheduler.beginExecution();
    scheduler.queueReload("workspace-a", "D:\\repo\\coverage.covdb");

    assert.equal(scheduler.hasActiveExecution(), true);
    assert.equal(scheduler.hasPendingReloads(), true);
    assert.deepEqual(
        scheduler.drainPendingReloads(
            new Map([["workspace-a", "D:\\repo\\coverage.covdb"]]),
        ),
        [],
    );

    assert.equal(scheduler.endExecution(), true);
    assert.deepEqual(
        scheduler.drainPendingReloads(
            new Map([["workspace-a", "D:\\repo\\coverage.covdb"]]),
        ),
        [
            {
                stateKey: "workspace-a",
                covdbPath: "D:\\repo\\coverage.covdb",
            },
        ],
    );
    assert.equal(scheduler.hasPendingReloads(), false);
});

test("CovdbReloadScheduler drops queued reloads for stale covdb paths", () => {
    const scheduler = new CovdbReloadScheduler();

    scheduler.queueReload("workspace-a", "D:\\repo\\old.covdb");

    assert.deepEqual(
        scheduler.drainPendingReloads(
            new Map([["workspace-a", "D:\\repo\\new.covdb"]]),
        ),
        [],
    );
    assert.equal(scheduler.hasPendingReloads(), false);
});

test("CovdbReloadScheduler tracks nested executions before draining", () => {
    const scheduler = new CovdbReloadScheduler();

    scheduler.beginExecution();
    scheduler.beginExecution();
    scheduler.queueReload("workspace-a", "D:\\repo\\coverage.covdb");

    assert.equal(scheduler.endExecution(), false);
    assert.deepEqual(
        scheduler.drainPendingReloads(
            new Map([["workspace-a", "D:\\repo\\coverage.covdb"]]),
        ),
        [],
    );

    assert.equal(scheduler.endExecution(), true);
    assert.deepEqual(
        scheduler.drainPendingReloads(
            new Map([["workspace-a", "D:\\repo\\coverage.covdb"]]),
        ),
        [
            {
                stateKey: "workspace-a",
                covdbPath: "D:\\repo\\coverage.covdb",
            },
        ],
    );
});
