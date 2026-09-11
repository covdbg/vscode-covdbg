import test from "node:test";
import assert from "node:assert/strict";
import { parseLoginPrompt, parseSignedInAs } from "../runner/signIn";

test("parseSignedInAs reads the email out of what covdbg prints", () => {
    assert.equal(parseSignedInAs("Signed in as dev@example.com.\r\n"), "dev@example.com");
    assert.equal(parseSignedInAs("Not signed in.\n"), undefined);
});

test("parseSignedInAs ignores the line about a sign-in being replaced", () => {
    const stdout = "Already signed in as old@example.com. Signing in again replaces it.\n";
    assert.equal(parseSignedInAs(stdout), undefined);
    assert.equal(parseSignedInAs(stdout + "Signed in as new@example.com.\n"), "new@example.com");
});

test("parseLoginPrompt finds the page and the code once both are printed", () => {
    const partial = "\n  Open https://app.covdbg.com/device?code=ABCD-1234\n";
    assert.equal(parseLoginPrompt(partial), undefined);
    assert.deepEqual(parseLoginPrompt(partial + "  and confirm the code there:  ABCD-1234\n"), {
        url: "https://app.covdbg.com/device?code=ABCD-1234",
        code: "ABCD-1234",
    });
});
