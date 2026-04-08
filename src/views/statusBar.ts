import * as vscode from "vscode";
import { LicenseStatusSnapshot } from "../runner/licenseStatus";
import { RenderMode } from "../types";

export class StatusBar {
    private _item: vscode.StatusBarItem;
    private _enabled: boolean = true;
    private _loaded: boolean = false;
    private _renderMode: RenderMode = "gutter";
    private _runState: "idle" | "running" | "failed" = "idle";
    private _licenseStatus?: LicenseStatusSnapshot;

    constructor() {
        this._item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
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

    public setLicenseStatus(status?: LicenseStatusSnapshot): void {
        this._licenseStatus = status;
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
        const licenseIndicator = this.getLicenseIndicator();
        if (this._runState === "running") {
            this._item.text = `covdbg $(sync~spin)${licenseIndicator.text}`;
            this._item.tooltip = `covdbg - Coverage run in progress${licenseIndicator.tooltip}`;
            return;
        }

        if (this._runState === "failed") {
            this._item.text = `covdbg $(error)${licenseIndicator.text}`;
            this._item.tooltip = `covdbg - Last coverage run failed${licenseIndicator.tooltip}`;
            return;
        }

        if (!this._loaded) {
            this._item.text = `covdbg $(workspace-unknown)${licenseIndicator.text}`;
            this._item.tooltip = `covdbg - No coverage loaded${licenseIndicator.tooltip}`;
            return;
        }
        const modeLabel =
            this._renderMode === "line"
                ? "Line"
                : this._renderMode === "gutter"
                    ? "Gutter"
                    : "Both";
        if (this._enabled) {
            this._item.text = `covdbg $(workspace-trusted)${licenseIndicator.text}`;
            this._item.tooltip = `covdbg - Coverage ON (${modeLabel})${licenseIndicator.tooltip}`;
        } else {
            this._item.text = `covdbg $(workspace-untrusted)${licenseIndicator.text}`;
            this._item.tooltip = `covdbg - Coverage OFF (${modeLabel})${licenseIndicator.tooltip}`;
        }
    }

    private getLicenseIndicator(): { text: string; tooltip: string } {
        if (
            !this._licenseStatus ||
            this._licenseStatus.source !== "plugin-demo"
        ) {
            return { text: "", tooltip: "" };
        }

        if (this._licenseStatus.status === "active") {
            const daysRemaining = Math.max(
                0,
                this._licenseStatus.daysRemaining ?? 0,
            );
            return {
                text: "",
                tooltip: `\nDemo license active: ${daysRemaining} day(s) remaining`,
            };
        }

        if (this._licenseStatus.status === "trial-used") {
            return {
                text: "",
                tooltip: "\nDemo license already used on this machine",
            };
        }

        return { text: "", tooltip: "" };
    }

    public dispose(): void {
        this._item.dispose();
    }
}
