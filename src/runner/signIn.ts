import { spawn } from "child_process";
import type * as vscode from "vscode";

/**
 * Who this machine is signed in as, according to `covdbg whoami`. The sign-in lives in the
 * Windows Credential Manager and belongs to covdbg, so the extension only ever asks; it never
 * reads or writes the credential itself.
 */
export interface SignInState {
    checked: boolean;
    email?: string;
    error?: string;
}

export interface SignInPrompt {
    url: string;
    code: string;
}

export interface SignInOutcome {
    email?: string;
    error?: string;
}

/** `covdbg whoami` and `covdbg login` both end with "Signed in as <email>." when there is one. */
export function parseSignedInAs(stdout: string): string | undefined {
    const match = /^Signed in as (.+)\.\s*$/m.exec(stdout);
    return match?.[1].trim();
}

/** The page and code `covdbg login` prints while it waits for the browser. */
export function parseLoginPrompt(stdout: string): SignInPrompt | undefined {
    const url = /^\s*Open (\S+)\s*$/m.exec(stdout);
    const code = /confirm the code there:\s+(\S+)\s*$/m.exec(stdout);
    return url && code ? { url: url[1], code: code[1] } : undefined;
}

export async function querySignIn(executablePath: string): Promise<SignInState> {
    const run = await runCovdbg(executablePath, ["whoami"], 15_000);
    if (run.error) {
        return { checked: true, error: run.error };
    }
    return { checked: true, email: parseSignedInAs(run.stdout) };
}

/**
 * Runs `covdbg login`, which prints the page to open and waits until the code is confirmed
 * there. `onPrompt` fires once the page and code are known; cancelling kills the wait.
 */
export function signIn(
    executablePath: string,
    onPrompt: (prompt: SignInPrompt) => void,
    cancellation: vscode.CancellationToken,
): Promise<SignInOutcome> {
    return new Promise<SignInOutcome>((resolve) => {
        const child = spawn(executablePath, ["login"], { windowsHide: true });
        let stdout = "";
        let stderr = "";
        let prompted = false;

        const subscription = cancellation.onCancellationRequested(() => child.kill());
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
            if (!prompted) {
                const prompt = parseLoginPrompt(stdout);
                if (prompt) {
                    prompted = true;
                    onPrompt(prompt);
                }
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", (error) => {
            subscription.dispose();
            resolve({ error: `Failed to start covdbg login: ${error.message}` });
        });
        child.on("close", (code) => {
            subscription.dispose();
            if (cancellation.isCancellationRequested) {
                resolve({ error: "Sign-in cancelled." });
                return;
            }
            const email = code === 0 ? parseSignedInAs(stdout) : undefined;
            if (email) {
                resolve({ email });
                return;
            }
            resolve({
                error:
                    lastLine(stderr) ?? lastLine(stdout) ?? `covdbg login exited with code ${code}`,
            });
        });
    });
}

/** Runs `covdbg logout`; the result is what covdbg said about it. */
export async function signOut(executablePath: string): Promise<{ message: string; ok: boolean }> {
    const run = await runCovdbg(executablePath, ["logout"], 30_000);
    if (run.error) {
        return { message: run.error, ok: false };
    }
    const message =
        lastLine(run.stderr) ??
        lastLine(run.stdout) ??
        `covdbg logout exited with code ${run.code}`;
    return { message, ok: run.code === 0 };
}

function lastLine(text: string): string | undefined {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

interface CovdbgRun {
    stdout: string;
    stderr: string;
    code: number | null;
    error?: string;
}

function runCovdbg(executablePath: string, args: string[], timeoutMs: number): Promise<CovdbgRun> {
    return new Promise<CovdbgRun>((resolve) => {
        const child = spawn(executablePath, args, { windowsHide: true });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (run: CovdbgRun) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(run);
            }
        };
        const timeout = setTimeout(() => {
            child.kill();
            finish({
                stdout,
                stderr,
                code: null,
                error: `covdbg ${args[0]} did not finish in time.`,
            });
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", (error) =>
            finish({
                stdout,
                stderr,
                code: null,
                error: `Failed to start covdbg: ${error.message}`,
            }),
        );
        child.on("close", (code) => finish({ stdout, stderr, code }));
    });
}
