/** Where a problem loading a .covdb is reported. */
export interface LoadProblemNotifier {
    log(message: string): void;
    toast(message: string): void;
}

/**
 * Says why a .covdb could not be shown, or returns undefined when it loaded with data.
 *
 * Always logged, and returned so the view can show it. A toast only when the user picked this
 * file: a load at startup or after a file changed on disk is nothing they are waiting on.
 */
export function reportLoadProblem(
    result: { error?: string; totalFileCount: number },
    userInitiated: boolean,
    notifier: LoadProblemNotifier,
): string | undefined {
    const problem =
        result.error ?? (result.totalFileCount === 0 ? "No coverage data in .covdb" : undefined);
    if (!problem) {
        return undefined;
    }
    // The load has just logged the path, and covdb errors carry it too.
    notifier.log(problem);
    if (userInitiated) {
        notifier.toast(`covdbg: ${problem}`);
    }
    return problem;
}
