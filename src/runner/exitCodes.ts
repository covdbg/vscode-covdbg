export const COVDBG_EXIT_NO_FUNCTIONS_TO_TRACK = 2;

export function getCovdbgRunFailureMessage(code: number | null): string {
    if (code === COVDBG_EXIT_NO_FUNCTIONS_TO_TRACK) {
        return "No functions passed the coverage filter. Adjust the file or function filters in .covdbg.yaml and try again.";
    }

    return `covdbg exited with code ${code}`;
}