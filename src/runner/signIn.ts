import { spawn } from "child_process";
import { LineBuffer } from "./lineBuffer";

/**
 * Who this machine is signed in as, according to `covdbg whoami`. The sign-in lives in the
 * Windows Credential Manager and belongs to covdbg, so the extension only ever asks; it never
 * reads or writes the credential itself.
 */
export type WhoamiResult =
    | { kind: "signedIn"; email?: string }
    | { kind: "signedOut" }
    | { kind: "error"; message: string };

export interface SignInPrompt {
    url: string;
    code: string;
}

export type SignInResult =
    | { kind: "signedIn"; email?: string }
    | { kind: "cancelled" }
    | { kind: "failed"; message: string };

export interface SignOutResult {
    ok: boolean;
    /** The "Signed out <email>." line, or why signing out failed. */
    message: string;
    /** covdbg's line about the session it could not end on the service, when there is one. */
    serviceProblem?: string;
}

/** Starts covdbg; a parameter so the tests can stand in for the process. */
export type SpawnCovdbg = (
    executablePath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
) => CovdbgProcess;

/** The part of a child process these commands use. */
export interface CovdbgProcess {
    stdout: NodeJS.EventEmitter;
    stderr: NodeJS.EventEmitter;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "close", listener: (code: number | null) => void): unknown;
    kill(): unknown;
}

const spawnCovdbg: SpawnCovdbg = (executablePath, args, env) =>
    spawn(executablePath, args, { env, windowsHide: true });

/** covdbg gives up on a sign-in after 10 minutes; this is the backstop if it does not. */
const SIGN_IN_TIMEOUT_MS = 11 * 60_000;

/** `covdbg whoami` and `covdbg login` both end with "Signed in as <email>." when there is one. */
export function parseSignedInAs(stdout: string): string | undefined {
    const match = /^Signed in as (.+)\.\s*$/m.exec(stdout);
    return match?.[1].trim();
}

/** `whoami` decides by its exit code: 0 is signed in, 1 is not. The text only names the email. */
export async function querySignIn(
    executablePath: string,
    env: NodeJS.ProcessEnv,
    start: SpawnCovdbg = spawnCovdbg,
): Promise<WhoamiResult> {
    const run = await runCovdbg(executablePath, ["whoami"], env, 15_000, start);
    if (run.error) {
        return { kind: "error", message: run.error };
    }
    if (run.code === 0) {
        return { kind: "signedIn", email: parseSignedInAs(run.stdout) };
    }
    if (run.code === 1) {
        return { kind: "signedOut" };
    }
    return { kind: "error", message: `covdbg whoami exited with code ${run.code}` };
}

/**
 * Runs `covdbg login`, which prints the page to open and waits until the code is confirmed
 * there. `onPrompt` fires once both the page and the code are known; aborting kills the wait.
 */
export function signIn(
    executablePath: string,
    env: NodeJS.ProcessEnv,
    onPrompt: (prompt: SignInPrompt) => void,
    signal: AbortSignal,
    start: SpawnCovdbg = spawnCovdbg,
): Promise<SignInResult> {
    return new Promise<SignInResult>((resolve) => {
        const child = start(executablePath, ["login"], env);
        const stdoutLines: string[] = [];
        let stderr = "";
        let url: string | undefined;
        let code: string | undefined;
        let prompted = false;
        let timedOut = false;

        const kill = () => child.kill();
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, SIGN_IN_TIMEOUT_MS);
        signal.addEventListener("abort", kill);
        let settled = false;
        const finish = (result: SignInResult) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                signal.removeEventListener("abort", kill);
                resolve(result);
            }
        };

        const stdout = new LineBuffer((line) => {
            stdoutLines.push(line);
            url ??= /^\s*Open (\S+)\s*$/.exec(line)?.[1];
            code ??= /confirm the code there:\s+(\S+)\s*$/.exec(line)?.[1];
            if (url && code && !prompted) {
                prompted = true;
                onPrompt({ url, code });
            }
        });
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += String(chunk);
        });
        child.on("error", (error) =>
            finish({ kind: "failed", message: `Failed to start covdbg login: ${error.message}` }),
        );
        child.on("close", (exitCode) => {
            stdout.flush();
            const printed = stdoutLines.join("\n");
            if (signal.aborted) {
                finish({ kind: "cancelled" });
            } else if (timedOut) {
                finish({ kind: "failed", message: "The sign-in did not finish in time." });
            } else if (exitCode === 0) {
                finish({ kind: "signedIn", email: parseSignedInAs(printed) });
            } else {
                // covdbg prints why a sign-in failed on stdout, after the prompt.
                finish({
                    kind: "failed",
                    message:
                        lastLine(printed) ??
                        lastLine(stderr) ??
                        `covdbg login exited with code ${exitCode}`,
                });
            }
        });
    });
}

/** Runs `covdbg logout`, which ends the sign-in for every covdbg on this machine. */
export async function signOut(
    executablePath: string,
    env: NodeJS.ProcessEnv,
    start: SpawnCovdbg = spawnCovdbg,
): Promise<SignOutResult> {
    const run = await runCovdbg(executablePath, ["logout"], env, 30_000, start);
    if (run.error) {
        return { ok: false, message: run.error };
    }
    if (run.code !== 0) {
        return {
            ok: false,
            message:
                lastLine(run.stdout) ??
                lastLine(run.stderr) ??
                `covdbg logout exited with code ${run.code}`,
        };
    }
    return { ok: true, ...parseSignOut(run.stdout) };
}

/** What `covdbg logout` said worth passing on: who was signed out, and any service problem. */
export function parseSignOut(stdout: string): { message: string; serviceProblem?: string } {
    const signedOut = /^(Signed out .+\.|Not signed in\.)\s*$/m.exec(stdout)?.[1];
    const serviceProblem = /^(covdbg: the session could not be ended on the service.*?)\s*$/m.exec(
        stdout,
    )?.[1];
    return { message: signedOut ?? "Signed out.", serviceProblem };
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

function runCovdbg(
    executablePath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    start: SpawnCovdbg,
): Promise<CovdbgRun> {
    return new Promise<CovdbgRun>((resolve) => {
        const child = start(executablePath, args, env);
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

        child.stdout.on("data", (chunk: Buffer) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
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
