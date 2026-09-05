/** The conditions a covdbg run needs, read from the editor by the caller. */
export interface CovdbgRunnability {
    /** `process.platform`. */
    platform: string;

    /** `vscode.workspace.isTrusted`. */
    isTrusted: boolean;

    /** `vscode.env.remoteName`, undefined when the window is local. */
    remoteName: string | undefined;
}

/**
 * Whether covdbg can run in this window.
 *
 * The same three conditions `ensurePreflight` enforces in the runner. The MCP path would
 * otherwise bypass them entirely, and package.json's `capabilities.untrustedWorkspaces` promises
 * in as many words that running coverage binaries requires trust — so offering the server in an
 * untrusted window would break a stated promise, not merely fail late.
 *
 * Kept free of any vscode import so the rule itself can be tested without an editor.
 */
export function isCovdbgRunnable(conditions: CovdbgRunnability): boolean {
    return (
        conditions.platform === "win32" &&
        conditions.isTrusted &&
        conditions.remoteName === undefined
    );
}
