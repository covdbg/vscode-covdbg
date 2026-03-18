import * as vscode from 'vscode';

let _outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!_outputChannel) {
        _outputChannel = vscode.window.createOutputChannel('covdbg');
    }
    return _outputChannel;
}

export function log(message: string): void {
    const channel = getOutputChannel();
    const timestamp = new Date().toISOString();
    channel.appendLine(`[${timestamp}] ${message}`);
}

export function logError(message: string): void {
    log(`ERROR: ${message}`);
}

export function show(): void {
    getOutputChannel().show(true);
}

export function dispose(): void {
    if (_outputChannel) {
        _outputChannel.dispose();
        _outputChannel = undefined;
    }
}
