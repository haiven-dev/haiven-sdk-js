// Runner #3 of the published conformance corpus, and the first one that is not
// a socket.
//
// `conformance.test.js` and `Haiven.Sdk.Conformance` both drive
// `gaming/v0`: one fixture, one protocol, six frame verbs. `moderation/v0` is
// published by the same repository under the same harness protocol and shares
// none of that — it declares `backend-moderation-fixture/v0` over **http** with
// two capabilities (`token.roles`, `studio.binding`) and a two-verb vocabulary
// (`request`, `expect`). So it could not be carried by the existing runners by
// pointing them at another file; it needs a runner of a different shape, and
// what that shape had to be is the measurement this file makes.
//
// The provider half already exists: `haiven-api`'s
// `internal/integration/sdkconformance` proves the surface answers this suite.
// This is the consumer half — the same corpus, executed by the SDK side against
// the same fixture, which is what makes the suite a shared obligation rather
// than a backend test that happens to be published.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { ModerationFixture, moderationUnavailable, operation, } from "../src/rest/moderation-fixture.js";
const SUITE = new URL("../../../haiven-contracts/conformance/sdk/moderation/v0/generated/suite.json", import.meta.url).pathname;
const suite = JSON.parse(readFileSync(SUITE, "utf8"));
/** This runner's name in the corpus, the same one the gaming runner answers to. */
const RUNNER = "node";
/**
 * The published target profile this runner is. `moderation/v0` declares two,
 * both with `runner: node`; a service is the one an SDK consumer writes.
 */
const PROFILE = "moderation/node-service";
/** What the fixture source can supply, declared rather than inferred. */
const CAPABILITIES = ["token.roles", "studio.binding"];
/**
 * Every name this runner answers a waiver to.
 *
 * The finding this file is really about. Waiver keys are **not** one namespace:
 * `gaming/v0` keys them by runner (`node`, `deployment`), `moderation/v0` keys
 * them by the suite's own lifecycle (`preview`), because what those two
 * scenarios record is a gap in the *provider* — role- and studio-scoped
 * moderation authorization is not active in Backend yet — and a provider gap
 * applies to every runner, not to one.
 *
 * A runner that claimed only its own name would execute both, fail both, and
 * report red for a gap the corpus already states. So a runner has to claim
 * every name it answers to. `suite.lifecycle` is read from the document rather
 * than hardcoded, which is what makes these waivers *lapse by themselves*: when
 * haiven-contracts promotes the suite past `preview`, the key stops matching,
 * the two scenarios start executing, and Backend's missing authorization
 * becomes a failure here instead of a footnote.
 */
const CLAIMED = [RUNNER, PROFILE, suite.lifecycle];
const waiverFor = (scenario) => {
    for (const key of CLAIMED) {
        const reason = scenario.waivers[key];
        if (reason !== undefined)
            return reason;
    }
    return undefined;
};
const runnable = suite.scenarios.filter((s) => waiverFor(s) === undefined);
// A minimal well-formed event. The suite asserts the operation's status, not
// its payload semantics, so this only has to decode.
const EVENT_BODY = {
    playerName: "conformance-player",
    jobId: "conformance-job",
    universeId: 1,
    placeId: 1,
    caseId: 1,
    decision: 1,
    eventType: 1,
    reasonCode: 1,
    confidence: 1,
    enforcementMode: 1,
    outcome: 1,
};
describe("the published moderation suite, read", () => {
    it("is the http suite this runner is shaped for", () => {
        // Guarding the shape rather than assuming it: pointing a socket runner at
        // this file is exactly the mistake the fixture declaration exists to stop,
        // and it would otherwise surface as a connection error.
        assert.equal(suite.id, "moderation/v0");
        assert.equal(suite.fixture.id, "backend-moderation-fixture/v0");
        assert.equal(suite.fixture.protocol, "http");
        assert.equal(suite.corpus_version, 1);
    });
    it("needs no fixture capability this runner's source cannot supply", () => {
        // The moderation counterpart of the gaming runner's token-kind guard.
        // Without it, a scenario needing an affordance this fixture lacks fails
        // deep in the transcript as an authorization error and reads as a server
        // bug rather than as a runner that should have waived.
        const missing = suite.fixture.capabilities.filter((c) => !CAPABILITIES.includes(c));
        assert.deepEqual(missing, [], "the suite needs a capability this fixture cannot offer; waive it");
    });
    it("waives the two scenarios Backend has not implemented, by lifecycle and not by runner", () => {
        // Pinned so the heterogeneous waiver keyspace is visible here rather than
        // as a surprise in the next runner.
        assert.deepEqual(suite.scenarios.filter((s) => waiverFor(s) !== undefined).map((s) => s.id), ["analyst-cannot-mutate", "wrong-studio-is-rejected"]);
        // None of them names this runner or this profile: claiming only those two
        // would execute both and report red for a recorded provider gap.
        for (const scenario of suite.scenarios) {
            assert.equal(scenario.waivers[RUNNER], undefined, `${scenario.id}: unexpectedly waives the runner`);
            assert.equal(scenario.waivers[PROFILE], undefined, `${scenario.id}: unexpectedly waives the profile`);
        }
    });
    it("still has a scenario to genuinely execute", () => {
        // A fully-waived suite passes while proving nothing, which is the one way
        // this file could go quietly vacuous.
        assert.deepEqual(runnable.map((s) => s.id), ["moderator-submits-a-studio-event"]);
    });
    it("names every operation as http:<METHOD>:</path>", () => {
        for (const scenario of suite.scenarios) {
            const { method, path } = operation(scenario.operation_id);
            assert.ok(method.length > 0, `${scenario.id}: no method`);
            assert.ok(path.startsWith("/"), `${scenario.id}: no path`);
        }
        for (const malformed of ["", "POST:/x", "ws:POST:/x", "http::/x", "http:POST:x"]) {
            assert.throws(() => operation(malformed), `"${malformed}" should not parse`);
        }
    });
});
const unavailable = await moderationUnavailable();
describe("the moderation suite, run by node", { skip: unavailable, timeout: 120_000 }, () => {
    let fx;
    before(async () => {
        fx = await ModerationFixture.start();
    });
    after(async () => {
        await fx?.stop();
    });
    for (const scenario of runnable) {
        it(`${scenario.id}: ${scenario.title}`, async () => {
            const { method, path } = operation(scenario.operation_id);
            let credential = null;
            let status = null;
            let body = null;
            for (const step of scenario.steps) {
                switch (step.do) {
                    case "request": {
                        credential = await fx.mint(scenario.role);
                        // A step may address a studio other than the one the credential
                        // is bound to; that crossing is the whole of
                        // `wrong-studio-is-rejected`, and it has to be expressible even
                        // on the cycles where that scenario is waived.
                        const studio = step.studio ?? credential.studio;
                        const answer = await fx.call(method, path, credential, studio, method === "GET" ? undefined : EVENT_BODY);
                        status = answer.status;
                        body = answer.body;
                        break;
                    }
                    case "expect": {
                        assert.notEqual(status, null, `${scenario.id}: expect before request`);
                        if (step.status !== undefined) {
                            assert.equal(status, step.status, `${scenario.id}: wrong HTTP status`);
                        }
                        for (const [field, expected] of Object.entries(step.fields ?? {})) {
                            assert.ok(body, `${scenario.id}: expected field "${field}", response carried no object body`);
                            assert.ok(field in body, `${scenario.id}: expected field "${field}", field absent`);
                            assert.deepEqual(body[field], expected, `${scenario.id}: ${field}`);
                        }
                        break;
                    }
                    default:
                        assert.fail(`${scenario.id}: unknown step "${step.do}"`);
                }
            }
        });
    }
    it("mints a credential bound to the studio the fixture announced", async () => {
        // `studio.binding` is a capability the suite declares, and the crossing
        // scenario is waived today — so without this the binding would be
        // unexercised and the capability claim above would be untested.
        const bound = await fx.mint("moderator");
        assert.equal(bound.studio, fx.info.studio);
        const elsewhere = await fx.mint("moderator", "outside-token-scope");
        assert.equal(elsewhere.studio, "outside-token-scope");
        assert.notEqual(elsewhere.token, bound.token);
    });
});
