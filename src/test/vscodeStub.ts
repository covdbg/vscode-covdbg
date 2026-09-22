import Module from "module";

class EventEmitter<T> {
    private listeners: ((value: T) => void)[] = [];
    readonly event = (listener: (value: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
    };
    fire(value: T): void {
        this.listeners.forEach((listener) => listener(value));
    }
    dispose(): void {
        this.listeners = [];
    }
}

/**
 * Just enough of the vscode API for modules that read it when called. Import this before the
 * module under test: `vscode` exists only inside the editor, not under node:test.
 */
export const vscodeStub = {
    EventEmitter,
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    workspace: { isTrusted: true },
    env: {
        remoteName: undefined as string | undefined,
        /** Every URL opened, as text. */
        opened: [] as string[],
        openExternal: async (uri: { toString(): string }) => {
            vscodeStub.env.opened.push(uri.toString());
            return true;
        },
        clipboard: {
            text: "",
            writeText: async (text: string) => {
                vscodeStub.env.clipboard.text = text;
            },
        },
    },
    commands: {
        /** The last value set for each context key. */
        context: new Map<string, unknown>(),
        executeCommand: async (command: string, ...args: unknown[]) => {
            if (command === "setContext") {
                vscodeStub.commands.context.set(args[0] as string, args[1]);
            }
        },
    },
    window: {
        createOutputChannel: () => ({ appendLine: () => undefined }),
        /** Every toast shown, as its message. */
        toasts: [] as string[],
        /** What the next showWarningMessage call answers, as the chosen item. */
        warningAnswer: undefined as string | undefined,
        showErrorMessage: async (message: string) => {
            vscodeStub.window.toasts.push(message);
            return undefined;
        },
        showWarningMessage: async (message: string) => {
            vscodeStub.window.toasts.push(message);
            return vscodeStub.window.warningAnswer;
        },
    },
};

const moduleLoader = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
};
const load = moduleLoader._load;
moduleLoader._load = function (this: unknown, request: string, ...rest: unknown[]) {
    return request === "vscode" ? vscodeStub : load.call(this, request, ...rest);
};
