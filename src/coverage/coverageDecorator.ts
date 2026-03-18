import * as vscode from 'vscode';
import { FileCoverage } from './covdbParser';
import { RenderMode } from '../types';

export { RenderMode };

export class CoverageDecorator {
    private _lineCoveredType: vscode.TextEditorDecorationType;
    private _lineUncoveredType: vscode.TextEditorDecorationType;
    private _gutterCoveredType: vscode.TextEditorDecorationType;
    private _gutterUncoveredType: vscode.TextEditorDecorationType;
    private _isEnabled: boolean = true;
    private _renderMode: RenderMode = 'line';

    constructor() {
        this._lineCoveredType = this.createLineCoveredDecoration();
        this._lineUncoveredType = this.createLineUncoveredDecoration();
        this._gutterCoveredType = this.createGutterDecoration('covered');
        this._gutterUncoveredType = this.createGutterDecoration('uncovered');
    }

    // -- Decoration factories -----------------------------------------------

    private createLineCoveredDecoration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
    }

    private createLineUncoveredDecoration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
    }

    private createGutterDecoration(kind: 'covered' | 'uncovered'): vscode.TextEditorDecorationType {
        const color = kind === 'covered' ? '#4caf50' : '#f44336';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
            `<rect x="5" y="2" width="6" height="12" rx="2" fill="${color}"/>` +
            `</svg>`;
        const uri = vscode.Uri.parse(
            `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
        );
        return vscode.window.createTextEditorDecorationType({
            gutterIconPath: uri,
            gutterIconSize: 'contain'
        });
    }

    // -- Public API ---------------------------------------------------------

    public getRenderMode(): RenderMode {
        return this._renderMode;
    }

    public setRenderMode(mode: RenderMode): void {
        this._renderMode = mode;
    }

    public setEnabled(enabled: boolean): void {
        this._isEnabled = enabled;
    }

    public isDisplayEnabled(): boolean {
        return this._isEnabled;
    }

    public applyDecorations(editor: vscode.TextEditor, coverage: FileCoverage): void {
        if (!this._isEnabled) {
            return;
        }

        const coveredRanges: vscode.DecorationOptions[] = [];
        const uncoveredRanges: vscode.DecorationOptions[] = [];

        for (const [lineNumber, lineCoverage] of coverage.lines) {
            const lineIndex = lineNumber - 1;
            if (lineIndex < 0 || lineIndex >= editor.document.lineCount) {
                continue;
            }

            const line = editor.document.lineAt(lineIndex);
            const range = new vscode.Range(lineIndex, 0, lineIndex, line.text.length);
            const hoverMessage = lineCoverage.isCovered
                ? `Covered (executed ${lineCoverage.executionCount} time${lineCoverage.executionCount !== 1 ? 's' : ''})`
                : 'Not covered';

            const opt: vscode.DecorationOptions = { range, hoverMessage };
            if (lineCoverage.isCovered) {
                coveredRanges.push(opt);
            } else {
                uncoveredRanges.push(opt);
            }
        }

        const showLine = this._renderMode === 'line' || this._renderMode === 'both';
        const showGutter = this._renderMode === 'gutter' || this._renderMode === 'both';

        editor.setDecorations(this._lineCoveredType, showLine ? coveredRanges : []);
        editor.setDecorations(this._lineUncoveredType, showLine ? uncoveredRanges : []);
        editor.setDecorations(this._gutterCoveredType, showGutter ? coveredRanges : []);
        editor.setDecorations(this._gutterUncoveredType, showGutter ? uncoveredRanges : []);
    }

    public clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this._lineCoveredType, []);
        editor.setDecorations(this._lineUncoveredType, []);
        editor.setDecorations(this._gutterCoveredType, []);
        editor.setDecorations(this._gutterUncoveredType, []);
    }

    public dispose(): void {
        this._lineCoveredType.dispose();
        this._lineUncoveredType.dispose();
        this._gutterCoveredType.dispose();
        this._gutterUncoveredType.dispose();
    }
}

