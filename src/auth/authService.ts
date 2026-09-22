import * as vscode from "vscode";
import * as output from "../views/outputChannel";
import { describeRuntimeProblem } from "../runner/executableResolver";
import type { RuntimeState } from "../runner/runnerTypes";
import { RunNotice, endsSignIn, summarizeNotices } from "../runner/runOutcome";
import { SpawnCovdbg, querySignIn, signIn, signOut } from "../runner/signIn";

/**
 * Whether runs can be licensed, as far as the editor can tell. covdbg owns the sign-in; this only
 * mirrors what `covdbg whoami` and `covdbg login` report.
 */
export type AuthState =
    | { kind: "unknown" }
    | { kind: "unavailable"; runtime: Exclude<RuntimeState, { kind: "ok" }> }
    | { kind: "token" }
    | { kind: "signedIn"; email?: string }
    | { kind: "signedOut" }
    | { kind: "signingIn"; url: string; code: string }
    | { kind: "error"; message: string };

export interface AuthServiceDeps {
    resolveRuntime: () => Promise<RuntimeState>;
    /** `covdbg.runner.env`, which runs are started with on top of the editor's environment. */
    readSettingsEnv: () => Record<string, string>;
    start?: SpawnCovdbg;
}

export type RunReadiness = { run: true } | { run: false; reason: string };

export const SIGN_IN_TO_RUN = "Sign in to covdbg to measure coverage.";

export class AuthService implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    /** Fires when the state or the last run's notice changes. */
    readonly onDidChange = this.changed.event;

    private _state: AuthState = { kind: "unknown" };
    private _lastRunNotice: RunNotice | undefined;
    private pendingSignIn: { promise: Promise<boolean>; abort: AbortController } | undefined;
    private refreshGeneration = 0;

    constructor(private readonly deps: AuthServiceDeps) {}

    get state(): AuthState {
        return this._state;
    }

    get lastRunNotice(): RunNotice | undefined {
        return this._lastRunNotice;
    }

    dispose(): void {
        this.pendingSignIn?.abort.abort();
        this.changed.dispose();
    }

    /** Asks covdbg again. Only the latest of overlapping refreshes is kept. */
    async refresh(): Promise<void> {
        const generation = ++this.refreshGeneration;
        const next = await this.check();
        if (generation === this.refreshGeneration && !this.pendingSignIn) {
            this.setState(next);
        }
    }

    /**
     * Runs `covdbg login`. A second call while one is waiting opens its page again and shares its
     * outcome, so there is never more than one sign-in in flight. Resolves to whether it worked.
     */
    signIn(): Promise<boolean> {
        if (this.pendingSignIn) {
            this.openSignInPage();
            return this.pendingSignIn.promise;
        }
        const abort = new AbortController();
        this.pendingSignIn = { abort, promise: this.runSignIn(abort.signal) };
        return this.pendingSignIn.promise;
    }

    cancelSignIn(): void {
        this.pendingSignIn?.abort.abort();
    }

    openSignInPage(): void {
        if (this._state.kind === "signingIn") {
            void vscode.env.openExternal(vscode.Uri.parse(this._state.url));
        }
    }

    async copySignInCode(): Promise<void> {
        if (this._state.kind === "signingIn") {
            await vscode.env.clipboard.writeText(this._state.code);
        }
    }

    async signOut(): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            "Sign out of covdbg?",
            { modal: true, detail: "Signs out every covdbg on this machine." },
            "Sign Out",
        );
        if (confirmed !== "Sign Out") {
            return;
        }
        const runtime = await this.deps.resolveRuntime();
        if (runtime.kind !== "ok") {
            void vscode.window.showErrorMessage(`covdbg: ${describeRuntimeProblem(runtime)}`);
            return;
        }

        const result = await signOut(runtime.path, this.runEnvironment(), this.deps.start);
        if (!result.ok) {
            output.logError(`Sign-out failed: ${result.message}`);
            void vscode.window.showErrorMessage(`covdbg: ${result.message}`);
        } else {
            output.log(result.message);
            if (result.serviceProblem) {
                output.log(result.serviceProblem);
                void vscode.window.showWarningMessage(result.serviceProblem);
            }
        }
        await this.refresh();
    }

    /**
     * Checked before a run. Signed out, it signs in and lets the same run go on; cancelled, the
     * run is skipped quietly. When whoami failed, the run goes ahead and covdbg decides.
     */
    async ensureReadyToRun(): Promise<RunReadiness> {
        if (!this.pendingSignIn) {
            await this.refresh();
        }
        const state = this._state;
        if (state.kind === "unavailable") {
            return { run: false, reason: describeRuntimeProblem(state.runtime) };
        }
        if (state.kind !== "signedOut" && state.kind !== "signingIn") {
            return { run: true };
        }
        if (await this.signIn()) {
            return { run: true };
        }
        this.setLastRunNotice({ kind: "message", message: SIGN_IN_TO_RUN, action: "signIn" });
        return { run: false, reason: SIGN_IN_TO_RUN };
    }

    /** Takes in what a run (or a batch of runs) said about its license. */
    applyRunNotices(notices: readonly RunNotice[]): void {
        this._lastRunNotice = summarizeNotices(notices);
        if (endsSignIn(notices)) {
            this.setState({ kind: "signedOut" });
        } else {
            this.changed.fire();
        }
    }

    /** The environment covdbg runs with: the editor's, then covdbg.runner.env over it. */
    private runEnvironment(): NodeJS.ProcessEnv {
        return { ...process.env, ...this.deps.readSettingsEnv() };
    }

    private async check(): Promise<AuthState> {
        const runtime = await this.deps.resolveRuntime();
        if (runtime.kind !== "ok") {
            return { kind: "unavailable", runtime };
        }
        const env = this.runEnvironment();
        // A project token decides runs on its own and wins over the stored sign-in.
        if (env["COVDBG_PROJECT_TOKEN"]?.trim()) {
            return { kind: "token" };
        }
        return querySignIn(runtime.path, env, this.deps.start);
    }

    private async runSignIn(signal: AbortSignal): Promise<boolean> {
        const runtime = await this.deps.resolveRuntime();
        const result =
            runtime.kind === "ok"
                ? await signIn(
                      runtime.path,
                      this.runEnvironment(),
                      (prompt) => {
                          this.setState({ kind: "signingIn", ...prompt });
                          this.openSignInPage();
                      },
                      signal,
                      this.deps.start,
                  )
                : ({ kind: "failed", message: describeRuntimeProblem(runtime) } as const);
        this.pendingSignIn = undefined;

        if (result.kind === "signedIn") {
            output.log(`Signed in${result.email ? ` as ${result.email}` : ""}.`);
            if (this._lastRunNotice?.action === "signIn") {
                this._lastRunNotice = undefined;
            }
        } else if (result.kind === "cancelled") {
            output.log("Sign-in cancelled.");
        } else {
            output.logError(`Sign-in did not complete: ${result.message}`);
            void vscode.window.showErrorMessage(`covdbg: ${result.message}`);
        }
        // whoami names the account, and puts the state back if the sign-in did not happen.
        await this.refresh();
        return result.kind === "signedIn";
    }

    private setLastRunNotice(notice: RunNotice | undefined): void {
        this._lastRunNotice = notice;
        this.changed.fire();
    }

    private setState(state: AuthState): void {
        this._state = state;
        void vscode.commands.executeCommand("setContext", "covdbg.auth", state.kind);
        void vscode.commands.executeCommand(
            "setContext",
            "covdbg.runtime",
            state.kind === "unavailable"
                ? state.runtime.kind
                : state.kind === "unknown"
                  ? "unknown"
                  : "ok",
        );
        this.changed.fire();
    }
}
