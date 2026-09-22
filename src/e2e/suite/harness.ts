import * as assert from "assert";
import * as vscode from "vscode";

/**
 * This file is inside the extension's folder, so `vscode` here is the same API object the
 * extension uses: whatever the spies replace is what the extension calls. They go in before the
 * extension is activated, so nothing it shows at startup is missed.
 */
export interface Spies {
    /** Every notification or modal: [severity, message, ...items]. */
    messages: string[][];
    /** The latest value set for each context key. */
    contexts: Map<string, unknown>;
    /** Every URL handed to openExternal (the browser is never opened). */
    opened: string[];
    /** What to answer a message with, by message text; unmatched messages are dismissed. */
    answers: Array<{ match: RegExp; item: string }>;
    tree?: vscode.TreeDataProvider<unknown>;
    mcp?: vscode.McpServerDefinitionProvider;
    /** How many times the covdbg output channel was brought to the front. */
    outputShown: number;
    /** Every line the extension wrote to its output channel. */
    log: string[];
}

export const EXTENSION_ID = "covdbg.covdbg";

export function installSpies(): Spies {
    const spies: Spies = {
        messages: [],
        contexts: new Map(),
        opened: [],
        answers: [],
        outputShown: 0,
        log: [],
    };
    const win = vscode.window as unknown as Record<string, unknown>;
    for (const [name, severity] of [
        ["showInformationMessage", "info"],
        ["showWarningMessage", "warning"],
        ["showErrorMessage", "error"],
    ] as const) {
        win[name] = async (message: string, ...rest: unknown[]) => {
            const items = rest.filter((item): item is string => typeof item === "string");
            spies.messages.push([severity, message, ...items]);
            return spies.answers.find((answer) => answer.match.test(message))?.item;
        };
    }
    const createTreeView = vscode.window.createTreeView;
    win.createTreeView = (id: string, options: vscode.TreeViewOptions<unknown>) => {
        if (id === "covdbg.homeView") {
            spies.tree = options.treeDataProvider;
        }
        return createTreeView(id, options);
    };
    const createOutputChannel = vscode.window.createOutputChannel;
    win.createOutputChannel = (...args: unknown[]) => {
        const channel = (createOutputChannel as (...a: unknown[]) => vscode.OutputChannel)(...args);
        // The API hands out frozen objects, so the channel is wrapped rather than patched.
        return new Proxy(channel, {
            get(target, property) {
                if (property === "appendLine") {
                    return (line: string) => {
                        spies.log.push(line);
                        target.appendLine(line);
                    };
                }
                if (property === "show") {
                    return (...showArgs: unknown[]) => {
                        spies.outputShown++;
                        (target.show as (...a: unknown[]) => void)(...showArgs);
                    };
                }
                const value = Reflect.get(target, property) as unknown;
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    };
    const lm = vscode.lm as unknown as Record<string, unknown>;
    const registerMcp = vscode.lm.registerMcpServerDefinitionProvider;
    lm.registerMcpServerDefinitionProvider = (
        id: string,
        provider: vscode.McpServerDefinitionProvider,
    ) => {
        spies.mcp = provider;
        return registerMcp(id, provider);
    };
    (vscode.env as unknown as Record<string, unknown>).openExternal = async (uri: vscode.Uri) => {
        spies.opened.push(uri.toString(true));
        return true;
    };
    const executeCommand = vscode.commands.executeCommand;
    (vscode.commands as unknown as Record<string, unknown>).executeCommand = (
        command: string,
        ...args: unknown[]
    ) => {
        if (command === "setContext") {
            spies.contexts.set(String(args[0]), args[1]);
        }
        return executeCommand(command, ...args);
    };
    return spies;
}

/**
 * Swaps the scenario's folder (COVDBG_E2E_FOLDER) in for the empty one the window opened on, the
 * way opening it would activate the extension, and waits for the activation.
 */
export async function openScenarioFolder(): Promise<string> {
    const folder = process.env.COVDBG_E2E_FOLDER;
    assert.ok(folder, "COVDBG_E2E_FOLDER is set");
    vscode.workspace.updateWorkspaceFolders(0, 1, { uri: vscode.Uri.file(folder) });
    await waitFor(
        "the extension to activate",
        () => vscode.extensions.getExtension(EXTENSION_ID)?.isActive,
    );
    return folder;
}

/** The Coverage view as text, one line per item, indented by depth. */
export async function treeText(spies: Spies): Promise<string> {
    const provider = spies.tree;
    if (!provider) {
        return "<no tree>";
    }
    const lines: string[] = [];
    const walk = async (parent: unknown, depth: number): Promise<void> => {
        for (const element of (await provider.getChildren(parent as never)) ?? []) {
            const item = await provider.getTreeItem(element as never);
            const label = typeof item.label === "string" ? item.label : (item.label?.label ?? "");
            const description =
                typeof item.description === "string" ? ` — ${item.description}` : "";
            lines.push(`${"  ".repeat(depth)}${label}${description}`);
            if (item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                await walk(element, depth + 1);
            }
        }
    };
    await walk(undefined, 0);
    return lines.join("\n");
}

export async function waitFor<T>(
    what: string,
    probe: () => T | undefined | false | Promise<T | undefined | false>,
    timeoutMs = 60_000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

/** Runs the named steps in order, printing each; the first failure fails the scenario. */
export async function steps(list: Array<[string, () => Promise<void>]>): Promise<void> {
    for (const [name, step] of list) {
        const started = Date.now();
        try {
            await step();
            console.log(`  ✔ ${name} (${Date.now() - started} ms)`);
        } catch (error) {
            console.log(`  ✖ ${name}`);
            throw error;
        }
    }
}

export { assert };
