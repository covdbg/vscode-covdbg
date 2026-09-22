import * as vscode from "vscode";
import { RenderMode } from "../types";
import type { AuthState } from "../auth/authService";
import type { RunNotice } from "../runner/runOutcome";

export class StatusBar {
    private _item: vscode.StatusBarItem;
    private _enabled: boolean = true;
    private _loaded: boolean = false;
    private _renderMode: RenderMode = "gutter";
    private _runState: "idle" | "running" | "failed" = "idle";
    private _auth: AuthState = { kind: "unknown" };
    private _notice: RunNotice | undefined;

    constructor() {
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._item.command = "covdbg.showMenu";
        this._item.text = "$(shield) covdbg";
        this._item.tooltip = "covdbg — Click to open";
        this._item.show();
    }

    public isCoverageEnabled(): boolean {
        return this._enabled;
    }
    public isLoaded(): boolean {
        return this._loaded;
    }
    public getRenderMode(): RenderMode {
        return this._renderMode;
    }

    public toggleCoverage(): boolean {
        this._enabled = !this._enabled;
        this.updateAppearance();
        return this._enabled;
    }

    public setIdle(): void {
        this._loaded = false;
        this._runState = "idle";
        this.updateAppearance();
    }

    public setLoaded(): void {
        this._loaded = true;
        this.updateAppearance();
    }

    public setRenderMode(mode: RenderMode): void {
        this._renderMode = mode;
        this.updateAppearance();
    }

    public setRunning(): void {
        this._runState = "running";
        this.updateAppearance();
    }

    public setRunSucceeded(): void {
        this._runState = "idle";
        this.updateAppearance();
    }

    public setRunFailed(): void {
        this._runState = "failed";
        this.updateAppearance();
    }

    public setAuth(auth: AuthState, notice: RunNotice | undefined): void {
        this._auth = auth;
        this._notice = notice;
        this.updateAppearance();
    }

    public clearLastRunResult(): void {
        this._runState = "idle";
        this.updateAppearance();
    }

    private updateAppearance(): void {
        this._item.command = "covdbg.showMenu";
        if (this._runState === "running") {
            this._item.text = `covdbg $(sync~spin)`;
            this._item.tooltip = `covdbg - Coverage run in progress`;
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

        // What covdbg said about the last run's license (gated, a lock, ...) rides along below.
        const notice = this._notice ? `\n${this._notice.message}` : "";

        if (this._runState === "failed") {
            this._item.text = `covdbg $(error)`;
            this._item.tooltip = `covdbg - Last coverage run failed${notice}`;
            return;
        }

        if (!this._loaded) {
            this._item.text = `covdbg $(workspace-unknown)`;
            this._item.tooltip = `covdbg - No coverage loaded${notice}`;
            return;
        }
        const modeLabel =
            this._renderMode === "line"
                ? "Line"
                : this._renderMode === "gutter"
                  ? "Gutter"
                  : "Both";
        if (this._enabled) {
            this._item.text = `covdbg $(workspace-trusted)`;
            this._item.tooltip = `covdbg - Coverage ON (${modeLabel})${notice}`;
        } else {
            this._item.text = `covdbg $(workspace-untrusted)`;
            this._item.tooltip = `covdbg - Coverage OFF (${modeLabel})${notice}`;
        }
    }

    public dispose(): void {
        this._item.dispose();
    }
}
