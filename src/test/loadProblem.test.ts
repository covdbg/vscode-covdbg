import test from "node:test";
import assert from "node:assert/strict";
import { reportLoadProblem } from "../coverage/loadProblem";

function recorder() {
    const logs: string[] = [];
    const toasts: string[] = [];
    return {
        logs,
        toasts,
        notifier: {
            log: (message: string) => logs.push(message),
            toast: (message: string) => toasts.push(message),
        },
    };
}

test("a corrupt .covdb loaded on its own is logged and shown in the view, not toasted", () => {
    const { logs, toasts, notifier } = recorder();

    const problem = reportLoadProblem(
        { error: "file is not a database", totalFileCount: 0 },
        false,
        notifier,
    );

    assert.equal(problem, "file is not a database");
    assert.deepEqual(logs, ["file is not a database"]);
    assert.deepEqual(toasts, []);
});

test("an empty .covdb loaded on its own is logged and shown in the view, not toasted", () => {
    const { logs, toasts, notifier } = recorder();

    const problem = reportLoadProblem({ totalFileCount: 0 }, false, notifier);

    assert.equal(problem, "No coverage data in .covdb");
    assert.equal(logs.length, 1);
    assert.deepEqual(toasts, []);
});

test("a .covdb the user picked says what is wrong with it", () => {
    const { toasts, notifier } = recorder();

    reportLoadProblem({ totalFileCount: 0 }, true, notifier);

    assert.deepEqual(toasts, ["covdbg: No coverage data in .covdb"]);
});

test("a .covdb with data reports nothing", () => {
    const { logs, toasts, notifier } = recorder();

    const problem = reportLoadProblem({ totalFileCount: 3 }, true, notifier);

    assert.equal(problem, undefined);
    assert.deepEqual(logs, []);
    assert.deepEqual(toasts, []);
});
