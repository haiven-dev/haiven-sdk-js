// Consumer runner for the feature-specific auth handoff corpus published by
// haiven-contracts. The provider is deterministic; the generated REST methods,
// request encodings, open errors, and client-side state boundary are under test.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { RestClient, RestError } from "../src/rest/client.js";
import { HandoffFixture, } from "../src/rest/handoff-fixture.js";
import { OpenCodec } from "../src/wire/code.js";
const SUITE = new URL("../../haiven-sdk/haiven-contracts/conformance/sdk/gaming-auth-handoff/v0/generated/suite.json", import.meta.url).pathname;
const suite = JSON.parse(readFileSync(SUITE, "utf8"));
function resolve(value, fixture) {
    if (typeof value !== "string" || !value.startsWith("$"))
        return value;
    return value
        .slice(1)
        .split(".")
        .reduce((current, key) => current[key], fixture);
}
async function acceptRestError(promise) {
    try {
        return await promise;
    }
    catch (error) {
        assert.ok(error instanceof RestError);
        return null;
    }
}
describe("the game auth handoff corpus, run by node", () => {
    it("keeps the published error vocabulary open", () => {
        assert.equal(suite.error_codes.extensible, true);
        const codec = new OpenCodec(suite.error_codes.known);
        assert.deepEqual(codec.parse("invalid_handoff_code"), {
            value: "invalid_handoff_code",
            recognised: true,
        });
        assert.deepEqual(codec.parse("future_handoff_policy"), {
            value: "future_handoff_policy",
            recognised: false,
        });
    });
    for (const scenario of suite.scenarios) {
        it(`${scenario.id}: ${scenario.title}`, async () => {
            const fixture = new HandoffFixture(suite.fixture);
            const savedCodes = new Map();
            let token = null;
            let clientError = null;
            const client = new RestClient({
                baseUrl: "https://fixture.example/v0",
                fetch: fixture.fetch,
                codes: new OpenCodec(suite.error_codes.known),
                tokens: {
                    read: () => token,
                    write: (next) => {
                        token = next;
                    },
                },
            });
            for (const step of scenario.steps) {
                switch (step.do) {
                    case "validate_state": {
                        const matches = fixture.state(step.expected ?? "") === fixture.state(step.actual ?? "");
                        clientError = matches ? null : "state_mismatch";
                        assert.equal(clientError, step.error ?? null);
                        break;
                    }
                    case "credential": {
                        token = fixture.credential(step.credential ?? "").access_token;
                        await acceptRestError(client.endpoints.getAuthHandoffCredential());
                        break;
                    }
                    case "create": {
                        const credential = fixture.credential(step.credential ?? "");
                        const integration = fixture.integration(step.integration ?? "");
                        const verifier = fixture.verifier(step.verifier ?? "");
                        token = credential.access_token;
                        const result = await acceptRestError(client.endpoints.postAuthHandoff({
                            body: {
                                integrationId: integration.id,
                                redirectUri: fixture.redirect(step.redirect ?? ""),
                                state: fixture.state(step.state ?? ""),
                                codeChallenge: verifier.challenge,
                                codeChallengeMethod: "S256",
                            },
                        }));
                        if (result?.code && step.save_code_as)
                            savedCodes.set(step.save_code_as, result.code);
                        break;
                    }
                    case "exchange": {
                        const code = savedCodes.get(step.code ?? "");
                        assert.ok(code, `${scenario.id}: unknown saved code ${step.code}`);
                        await acceptRestError(client.endpoints.postAuthHandoffExchange({
                            body: {
                                code,
                                code_verifier: fixture.verifier(step.verifier ?? "").value,
                                integration_id: fixture.integration(step.integration ?? "").id,
                                redirect_uri: fixture.redirect(step.redirect ?? ""),
                            },
                        }));
                        break;
                    }
                    case "advance_clock":
                        fixture.advance(step.seconds ?? 0);
                        break;
                    case "expect": {
                        const response = fixture.lastResponse;
                        assert.ok(response, `${scenario.id}: expect before a response`);
                        assert.equal(response.status, step.status);
                        for (const [name, expected] of Object.entries(step.headers ?? {})) {
                            assert.equal(response.headers[name], expected, `${scenario.id}: header ${name}`);
                        }
                        for (const [name, expected] of Object.entries(step.fields ?? {})) {
                            assert.deepEqual(response.body[name], resolve(expected, suite.fixture), `${scenario.id}: ${name}`);
                        }
                        for (const name of step.absent_fields ?? []) {
                            assert.equal(name in response.body, false, `${scenario.id}: unexpected ${name}`);
                        }
                        break;
                    }
                    case "expect_no_request":
                        assert.equal(fixture.requests[step.operation ?? "exchange"], 0);
                        assert.equal(clientError, "state_mismatch");
                        break;
                    default:
                        assert.fail(`${scenario.id}: unknown step ${step.do}`);
                }
            }
        });
    }
});
