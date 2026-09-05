import type { RunnerSettings } from "./runnerTypes";

export interface LicenseRunConfig {
    /**
     * Licence arguments for a covdbg run. Empty when the environment already carries a licence.
     *
     * These belong on a covdbg process that actually measures coverage. `covdbg mcp` accepts them,
     * because they are global options, but never uses them: it serves the protocol and holds no
     * licence of its own, and the runs its `run` tool spawns build their own licence arguments
     * from the environment they inherit. Give the MCP server `env`, not `args`.
     */
    args: string[];

    /** Environment for the covdbg process, with the configured licence server folded in. */
    env: Record<string, string>;

    /** True when a demo licence will be requested, so the caller can say so in its log. */
    requestsDemoLicense: boolean;
}

/**
 * Decide how a covdbg process should obtain its licence.
 *
 * If the environment already names a licence, covdbg is left to use it and no licence arguments
 * are added — the options are mutually exclusive in covdbg's CLI, so passing `--demo` alongside
 * COVDBG_LICENSE is a hard error rather than a preference. Otherwise a plugin demo licence is
 * requested.
 *
 * Kept free of any vscode import so it can be tested directly; the caller supplies the version.
 *
 * @param settings      The configured environment and licence server
 * @param pluginVersion Version reported with a demo request, omitted when not known
 */
export function buildLicenseRunConfig(
    settings: Pick<RunnerSettings, "env" | "licenseServerUrl">,
    pluginVersion?: string,
): LicenseRunConfig {
    const env = { ...settings.env };

    if (settings.licenseServerUrl) {
        env.COVDBG_LICENSE_SERVER_URL = settings.licenseServerUrl;
    }

    const hasExplicitLicense = [
        env.COVDBG_LICENSE,
        env.COVDBG_LICENSE_FILE,
        env.COVDBG_FETCH_LICENSE,
    ].some((value) => typeof value === "string" && value.trim().length > 0);

    if (hasExplicitLicense) {
        return { args: [], env, requestsDemoLicense: false };
    }

    const args = ["--demo", "--plugin-name", "vscode"];
    if (typeof pluginVersion === "string" && pluginVersion.trim().length > 0) {
        args.push("--plugin-ver", pluginVersion.trim());
    }

    return { args, env, requestsDemoLicense: true };
}
