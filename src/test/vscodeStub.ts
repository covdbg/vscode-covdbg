import Module from "module";

/**
 * Just enough of the vscode API for modules that read it when called. Import this before the
 * module under test: `vscode` exists only inside the editor, not under node:test.
 */
export const vscodeStub = {
    workspace: { isTrusted: true },
    env: { remoteName: undefined as string | undefined },
    window: {
        createOutputChannel: () => ({ appendLine: () => undefined }),
    },
};

const moduleLoader = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
};
const load = moduleLoader._load;
moduleLoader._load = function (this: unknown, request: string, ...rest: unknown[]) {
    return request === "vscode" ? vscodeStub : load.call(this, request, ...rest);
};
