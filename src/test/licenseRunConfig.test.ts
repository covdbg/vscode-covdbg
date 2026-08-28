import test from "node:test";
import assert from "node:assert/strict";
import { buildLicenseRunConfig } from "../runner/licenseRunConfig";

test("buildLicenseRunConfig requests a demo licence when the environment carries none", () => {
    const config = buildLicenseRunConfig({ env: {}, licenseServerUrl: "" }, "0.8.1");

    assert.deepEqual(config.args, ["--demo", "--plugin-name", "vscode", "--plugin-ver", "0.8.1"]);
    assert.equal(config.requestsDemoLicense, true);
});

test("buildLicenseRunConfig omits the version when it is not known", () => {
    const config = buildLicenseRunConfig({ env: {}, licenseServerUrl: "" });

    assert.deepEqual(config.args, ["--demo", "--plugin-name", "vscode"]);
});

test("buildLicenseRunConfig passes no licence arguments when the environment names a licence", () => {
    // covdbg declares these options mutually exclusive, so adding --demo here is not a preference
    // that loses - it is a CLI error that fails the run before anything starts.
    for (const variable of ["COVDBG_LICENSE", "COVDBG_LICENSE_FILE", "COVDBG_FETCH_LICENSE"]) {
        const config = buildLicenseRunConfig(
            { env: { [variable]: "a-token" }, licenseServerUrl: "" },
            "0.8.1",
        );

        assert.deepEqual(config.args, [], `${variable} should suppress the licence arguments`);
        assert.equal(config.requestsDemoLicense, false);
    }
});

test("buildLicenseRunConfig treats a whitespace-only licence variable as unset", () => {
    const env: Record<string, string> = {};
    env.COVDBG_LICENSE = "   ";
    const config = buildLicenseRunConfig({ env, licenseServerUrl: "" });

    assert.deepEqual(config.args, ["--demo", "--plugin-name", "vscode"]);
});

test("buildLicenseRunConfig folds the configured licence server into the environment", () => {
    const env: Record<string, string> = {};
    env.EXISTING = "kept";
    const config = buildLicenseRunConfig({ env, licenseServerUrl: "https://license.example.com" });

    assert.equal(config.env.COVDBG_LICENSE_SERVER_URL, "https://license.example.com");
    assert.equal(config.env.EXISTING, "kept");
});

test("buildLicenseRunConfig does not mutate the settings it was given", () => {
    const settings = { env: {} as Record<string, string>, licenseServerUrl: "https://example.com" };
    buildLicenseRunConfig(settings);

    assert.deepEqual(settings.env, {}, "the caller's environment must be left alone");
});
