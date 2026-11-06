// Runner #1 of the conformance suite: node, executing the declarative corpus
// against the live fixture.
//
// The point is not that these behaviours are untested — live.test.js proves all
// of them already, in prose. The point is that the *same file* has to be
// executable by a dotnet runner, a Godot headless runner and an Unreal
// automation runner, and the only way to find out whether the step vocabulary is
// expressible in four languages is to write one interpreter and see what it
// needed. Anything this runner had to special-case is a scenario the other three
// will not be able to run.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { LiveFixture, liveUnavailable } from "../src/ws/live.js";
// The suite is published by haiven-contracts and vendored through the pinned
// submodule. It used to be a local fork at conformance/corpus.json; that fork
// drifted to assert a handshake the server stopped sending, and nobody saw it
// because this runner was skipping on a stale backend path.
const CONTRACTS = process.env.HAIVEN_CONTRACTS_ROOT ?? new URL("../../haiven-contracts", import.meta.url).pathname;
const SUITE = `${CONTRACTS}/conformance/sdk/gaming/v0/generated/suite.json`;
const corpus = JSON.parse(readFileSync(SUITE, "utf8"));
const unavailable = await liveUnavailable();
describe("the conformance corpus, run by node", { skip: unavailable, timeout: 120_000 }, () => {
    let fx;
    /**
     * The fixture token source: it mints, so it supplies both kinds.
     *
     * A deployment source is the one that cannot. It signs in and receives a
     * usable token, so it supplies `valid` and nothing else — and waiving on that
     * costs it one scenario instead of all of them, which is the measurement the
     * kind split was made for.
     */
    const tokens = {
        supplies: ["valid", "expired"],
        // A negative ttl sits inside the verifier's 30s leeway, so the token
        // verifies while the session it mints is already lapsed. That is how the
        // expired paths are reached without waiting out a real expiry.
        supply: (kind) => fx.token(kind === "expired" ? "-1s" : "1h"),
    };
    before(async () => {
        fx = await LiveFixture.start();
    });
    after(async () => {
        await fx?.stop();
    });
    // A waiver is a recorded gap, not a skip: it names the runner that cannot
    // execute the scenario and why. `deployment` is waived here because the step
    // needs the fixture's push affordance, which a real backend does not expose.
    const runnable = corpus.scenarios.filter((s) => !("node" in s.waivers));
    it("has scenarios to run", () => {
        assert.ok(runnable.length > 0);
        assert.equal(corpus.corpus_version, 1);
    });
    it("needs no token kind this runner's source cannot supply", () => {
        // The guard that keeps a waiver honest. Without it, a scenario asking for
        // a kind this source does not have would fail deep inside the transcript
        // as a protocol error, which reads as a server bug rather than as a
        // runner that should have waived.
        const needed = new Set(runnable.flatMap((s) => s.steps.filter((step) => step.do === "auth").map((step) => step.token ?? "valid")));
        const missing = [...needed].filter((kind) => !tokens.supplies.includes(kind));
        assert.deepEqual(missing, [], "a scenario needs a token kind this runner cannot produce; waive it");
    });
    it("costs a deployment runner only the scenarios that need a lapsed session", () => {
        // The measurement the kind split was made for, pinned so a regression to
        // a ttl-shaped `auth` is visible here rather than in an argument. The list
        // is the corpus's own set of `token: expired` scenarios, in corpus order:
        // the lapsed handshake (SDK-SESSION-4) and the per-request refusal inside
        // a lapsed session (SDK-SESSION-14). Both waive `deployment` for that
        // reason. A new entry here is a scenario the corpus added that a
        // deployment runner cannot reach, and it should be a deliberate edit.
        const deployment = ["valid"];
        const blocked = corpus.scenarios.filter((s) => s.steps.some((step) => step.do === "auth" && !deployment.includes(step.token ?? "valid")));
        assert.deepEqual(blocked.map((s) => s.id), ["handshake-into-a-lapsed-session-says-so", "a-lapsed-session-refuses-each-request-by-name"]);
        for (const scenario of blocked) {
            assert.ok("deployment" in scenario.waivers, `${scenario.id}: needs a kind a deployment source lacks and does not waive deployment`);
        }
    });
    for (const scenario of runnable) {
        it(`${scenario.id}: ${scenario.title}`, async () => {
            let client = null;
            for (const step of scenario.steps) {
                switch (step.do) {
                    case "connect":
                        client = await fx.client();
                        break;
                    case "auth": {
                        assert.ok(client, `${scenario.id}: auth before connect`);
                        client.send({
                            type: "auth",
                            requestId: step.requestId ?? "",
                            payload: await tokens.supply(step.token ?? "valid"),
                        });
                        break;
                    }
                    case "send":
                        assert.ok(client && step.frame, `${scenario.id}: send needs a frame`);
                        client.send({
                            type: step.frame.type,
                            requestId: step.frame.requestId ?? "",
                            ...(step.frame.payload === undefined ? {} : { payload: step.frame.payload }),
                        });
                        break;
                    case "push":
                        assert.ok(step.frame, `${scenario.id}: push needs a frame`);
                        await fx.push({ type: step.frame.type, payload: step.frame.payload });
                        break;
                    case "expect": {
                        assert.ok(client, `${scenario.id}: expect before connect`);
                        const frame = await client.next();
                        assert.equal(frame.type, step.type, `${scenario.id}: wrong frame type`);
                        if (step.keys) {
                            assert.deepEqual(Object.keys(frame).sort(), [...step.keys].sort(), `${scenario.id}: unexpected key set`);
                        }
                        for (const [field, expected] of Object.entries(step.fields ?? {})) {
                            assert.deepEqual(frame[field], expected, `${scenario.id}: ${field}`);
                        }
                        break;
                    }
                    case "expectSilence": {
                        assert.ok(client, `${scenario.id}: expectSilence before connect`);
                        const arrived = await client.quiesce(step.ms ?? 500);
                        assert.deepEqual(arrived.map((f) => f.type), [], `${scenario.id}: expected silence`);
                        break;
                    }
                    default:
                        assert.fail(`${scenario.id}: unknown step "${step.do}"`);
                }
            }
            client?.close();
        });
    }
});
