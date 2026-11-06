// Runner #1 of the client corpus: the TypeScript session against a scripted server.
//
// `gaming/v0` proves the server through a raw transcript. `gaming-client/v0`
// proves this binding: a scenario scripts exactly the frames the server sends,
// and asserts what the session wrote and what it handed to its caller. The
// socket is the injected `SocketLike`, driven synchronously, so a scenario is a
// deterministic sequence with no timing in it. The same file is executed by the
// dotnet, C++ and GDScript runners against their own session cores.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Session } from "../src/ws/session.js";
const SDK = process.env.HAIVEN_SDK_ROOT ?? new URL("../../haiven-sdk", import.meta.url).pathname;
const SUITE = `${SDK}/conformance/gaming-client/v0/generated/suite.json`;
/** The names this runner answers to in a scenario's `waivers`. */
const RUNNER = "node";
const PROFILE = "gaming/node";
const suite = JSON.parse(readFileSync(SUITE, "utf8"));
/** The transport a scenario drives: a socket whose far end is the script. */
class ScriptedSocket {
    sent = [];
    onmessage = null;
    onclose = null;
    onerror = null;
    onopen = null;
    send(data) {
        this.sent.push(JSON.parse(data));
    }
    close() { }
}
/** Replaces every `{"ref": alias}` with the request id bound to that alias. */
function resolve(value, bound) {
    if (Array.isArray(value))
        return value.map((item) => resolve(item, bound));
    if (value !== null && typeof value === "object") {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === "ref" && typeof value.ref === "string") {
            const id = bound.get(value.ref);
            assert.ok(id !== undefined, `nothing is bound to ${value.ref}`);
            return id;
        }
        return Object.fromEntries(keys.map((key) => [key, resolve(value[key], bound)]));
    }
    return value;
}
function run(scenario) {
    const socket = new ScriptedSocket();
    const delivered = [];
    let counter = 0;
    const session = new Session({
        socket,
        token: () => "scripted-token",
        requestId: () => `rq-${++counter}`,
        retainEvents: false,
        onEvent: (event) => {
            if (event.kind === "frame")
                delivered.push(event.frame);
        },
    });
    const bound = new Map();
    let read = 0;
    let seen = 0;
    for (const [index, step] of scenario.steps.entries()) {
        const at = `step ${index + 1} (${step.do})`;
        switch (step.do) {
            case "open":
                socket.onopen?.();
                break;
            case "call":
                session.send(step.type, step.payload);
                break;
            case "serve":
                socket.onmessage?.({ data: JSON.stringify(resolve(step.frame, bound)) });
                break;
            case "expectSent": {
                const frame = socket.sent[read++];
                assert.ok(frame !== undefined, `${at}: expected a ${step.type} and nothing was written`);
                assert.equal(frame.type, step.type, `${at}: wrote the wrong type`);
                const requestId = frame.requestId;
                if (step.bind !== undefined)
                    bound.set(step.bind, requestId);
                if (step.same !== undefined)
                    assert.equal(requestId, bound.get(step.same), `${at}: not ${step.same}`);
                break;
            }
            case "expectQuiet":
                assert.deepEqual(socket.sent.slice(read), [], `${at}: wrote more than the scenario expects`);
                break;
            case "expectState":
                assert.equal(session.state, step.state, `${at}: wrong state`);
                break;
            case "expectDelivered": {
                const offset = delivered.slice(seen).findIndex((frame) => frame.type === step.type);
                assert.ok(offset >= 0, `${at}: no ${step.type} was handed to the caller`);
                const frame = delivered[seen + offset];
                seen += offset + 1;
                if (step.error !== undefined)
                    assert.equal(frame.error?.value, step.error, `${at}: error code`);
                break;
            }
            default:
                assert.fail(`${at}: unknown step`);
        }
    }
}
describe("the client conformance corpus, run by node", () => {
    const claimed = [RUNNER, PROFILE, suite.lifecycle];
    it("has scenarios to run", () => {
        assert.ok(suite.scenarios.length > 0);
    });
    for (const scenario of suite.scenarios) {
        const waiver = claimed.find((name) => name in scenario.waivers);
        it(`${scenario.id}: ${scenario.title}`, { skip: waiver && scenario.waivers[waiver] }, () => run(scenario));
    }
});
