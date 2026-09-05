import * as vscode from "vscode";
import { RenderMode } from "../types";

export class StatusBar {
    private _item: vscode.StatusBarItem;
    private _enabled: boolean = true;
    private _loaded: boolean = false;
    private _renderMode: RenderMode = "gutter";
    private _runState: "idle" | "running" | "failed" = "idle";

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

    public clearLastRunResult(): void {
        this._runState = "idle";
        this.updateAppearance();
    }

    private updateAppearance(): void {
        if (this._runState === "running") {
            this._item.text = `covdbg $(sync~spin)`;
            this._item.tooltip = `covdbg - Coverage run in progress`;
            return;
        }

        if (this._runState === "failed") {
            this._item.text = `covdbg $(error)`;
            this._item.tooltip = `covdbg - Last coverage run failed`;
            return;
        }

        if (!this._loaded) {
            this._item.text = `covdbg $(workspace-unknown)`;
            this._item.tooltip = `covdbg - No coverage loaded`;
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
            this._item.tooltip = `covdbg - Coverage ON (${modeLabel})`;
        } else {
            this._item.text = `covdbg $(workspace-untrusted)`;
            this._item.tooltip = `covdbg - Coverage OFF (${modeLabel})`;
        }
    }

    public dispose(): void {
        this._item.dispose();
    }
}
