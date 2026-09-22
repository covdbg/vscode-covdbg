import * as vscode from "vscode";
import { RenderMode } from "../types";
import type { AuthState } from "../auth/authService";
import type { RunNotice } from "../runner/runOutcome";
import type { RuntimeState } from "../runner/runnerTypes";
import { describeRuntime } from "./coverageTree";

export class StatusBar {
    private _item: vscode.StatusBarItem;
    private _enabled: boolean = true;
    private _loaded: boolean = false;
    private _renderMode: RenderMode = "gutter";
    private _percent = 0;
    private _running = false;
    private _auth: AuthState = { kind: "unknown" };
    private _notice: RunNotice | undefined;
    private _runtime: RuntimeState | undefined;

    constructor() {
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._item.name = "covdbg";
    }

    public isCoverageEnabled(): boolean {
        return this._enabled;
    }

    public toggleCoverage(): boolean {
        this._enabled = !this._enabled;
        this.updateAppearance();
        return this._enabled;
    }

    public setIdle(): void {
        this._loaded = false;
        this.updateAppearance();
    }

    /** Coverage is loaded; `percent` is its line coverage. */
    public setLoaded(percent: number): void {
        this._loaded = true;
        this._percent = percent;
        this.updateAppearance();
    }

    public setRenderMode(mode: RenderMode): void {
        this._renderMode = mode;
        this.updateAppearance();
    }

    public setRunning(): void {
        this._running = true;
        this.updateAppearance();
    }

    /** A run ended, whether it worked or not: Test Results says which. */
    public setRunFinished(): void {
        this._running = false;
        this.updateAppearance();
    }

    public setAuth(
        auth: AuthState,
        notice: RunNotice | undefined,
        runtime: RuntimeState | undefined,
    ): void {
        this._auth = auth;
        this._notice = notice;
        this._runtime = runtime;
        this.updateAppearance();
    }

    private updateAppearance(): void {
        this._item.command = "covdbg.showMenu";
        this._item.show();
        if (this._running) {
            this._item.text = "$(sync~spin) covdbg";
            this._item.tooltip = "covdbg - Coverage run in progress";
            return;
        }

        // Only a run asks for a sign-in here; being signed out alone is shown in the view.
        if (
            this._auth.kind === "signingIn" ||
            (this._auth.kind === "signedOut" && this._notice?.action === "signIn")
        ) {
            this._item.text = "$(account) Sign in to covdbg";
            this._item.tooltip =
                this._auth.kind === "signingIn"
                    ? `covdbg - Confirm the code ${this._auth.code} in your browser`
                    : `covdbg - ${this._notice?.message}`;
            this._item.command = "covdbg.signIn";
            return;
        }

        if (!this._loaded) {
            this._item.hide();
            return;
        }
        const modeLabel =
            this._renderMode === "line"
                ? "Line"
                : this._renderMode === "gutter"
                  ? "Gutter"
                  : "Both";
        // Which covdbg runs, and what it said about the last run's license (gated, a lock, ...).
        const details = [describeRuntime(this._runtime), this._notice?.message]
            .filter(Boolean)
            .map((line) => `\n${line}`)
            .join("");
        this._item.text = `$(beaker) ${this._percent.toFixed(1)}%`;
        this._item.tooltip = `covdbg - Coverage ${this._enabled ? "ON" : "OFF"} (${modeLabel})${details}`;
    }

    public dispose(): void {
        this._item.dispose();
    }
}
