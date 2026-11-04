// What assembling the two cores into one entry point actually buys.
//
// Both were already complete and already tested apart, so a test that only
// showed the entry point constructs them would be measuring nothing. What is
// worth pinning is the behaviour that does not exist until they share state:
// a REST refresh becoming visible to a socket that was opened before it.
//
// That is `#mobileclientfix` stated as a test. `packages/app` and
// `apps/mobile` each hold the access token in their own place and hand the
// socket a copy at construction, so a refresh updates one lifecycle and not the
// other, and nothing fails at the moment they diverge.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HaivenClient } from "../src/client.js";
import { FakeServerSocket } from "../src/ws/fake-server.js";
const VOCABULARY = ["unauthorized", "bad_request", "rate_limit_reached"];
function respond(status, body) {
    // The server sets Content-Type only when it writes a body, which is what
    // makes a 204 headerless. Same branch as `response.JSON`.
    const contentType = body === undefined ? null : "application/json; charset=utf-8";
    return {
        status,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
        text: async () => (body === undefined ? "" : JSON.stringify(body)),
    };
}
/** A token store that records writes, standing in for whatever the host has. */
function storeOf(initial) {
    let held = initial;
    const writes = [];
    return {
        writes,
        read: () => held,
        write: (token) => {
            held = token;
            writes.push(token);
        },
    };
}
function clientOf(responses, options = {}) {
    const queue = [...responses];
    const sockets = [];
    const tokens = options.tokens ?? storeOf("access-1");
    const requests = [];
    const client = new HaivenClient({
        baseUrl: "https://api.test/v0",
        socketUrl: "wss://api.test/v0/ws",
        tokens,
        refresh: options.refresh,
        vocabulary: VOCABULARY,
        requestId: () => `req-${requests.length + 1}`,
        fetch: async (url, init) => {
            requests.push(`${init?.method ?? "GET"} ${url}`);
            const next = queue.shift();
            assert.ok(next, `unexpected request: ${url}`);
            return next;
        },
        connect: () => {
            // Both tokens are accepted; which one arrives is the measurement, so
            // the fake must not be the thing that rejects the stale one.
            const socket = new FakeServerSocket({
                tokens: [
                    { value: "access-1", userId: "u1", valid: true },
                    { value: "access-2", userId: "u1", valid: true },
                ],
            });
            sockets.push(socket);
            return socket;
        },
    });
    return { client, tokens, sockets, requests };
}
describe("the assembled client", () => {
    it("gives both transports one token store, so a refresh reaches the socket", async () => {
        const tokens = storeOf("access-1");
        const { client, sockets } = clientOf([respond(401), respond(200, { ok: true })], {
            tokens,
            refresh: async () => "access-2",
        });
        // The socket is opened FIRST, with the old token, and stays open. That
        // ordering is what makes the two shipped clients wrong: they capture the
        // token at this point and never look again.
        const session = client.connect();
        const socket = sockets[0];
        socket.open();
        const handshakes = () => socket.sent.filter((frame) => frame.type === "auth");
        assert.deepEqual(handshakes().map((frame) => frame.payload), ["access-1"]);
        // A REST call refreshes, entirely on the other transport.
        await client.rest.request("/me");
        assert.equal(tokens.read(), "access-2", "the refresh wrote through");
        // Now make the server lapse the session, which is what asks the socket to
        // re-authenticate. Nothing connects the two cores except the store.
        socket.expireSession();
        session.send("chat.message.send", { content: "after" });
        assert.deepEqual(handshakes().map((frame) => frame.payload), ["access-1", "access-2"], "the re-auth read the store rather than a captured copy");
        assert.equal(sockets.length, 1, "re-auth happened on the same socket, not a reconnect");
    });
    it("shares one vocabulary, so the two transports cannot disagree about a code", async () => {
        const { client } = clientOf([respond(429, { code: "rate_limit_reached", message: "slow down" })]);
        await assert.rejects(() => client.rest.request("/me"), (error) => {
            assert.equal(error.code?.value, "rate_limit_reached");
            assert.equal(error.code?.recognised, true);
            return true;
        });
    });
    it("carries a code minted after this build rather than failing to parse it", async () => {
        const { client } = clientOf([respond(400, { code: "invented_later", message: "nope" })]);
        await assert.rejects(() => client.rest.request("/thing"), (error) => {
            assert.equal(error.code?.value, "invented_later");
            assert.equal(error.code?.recognised, false, "recognition is relative to what shipped");
            return true;
        });
    });
    it("does not open a socket until asked", () => {
        const { client, sockets } = clientOf([]);
        assert.equal(sockets.length, 0, "constructing a client is not connecting");
        assert.equal(client.session, null);
        client.connect();
        assert.equal(sockets.length, 1);
        assert.notEqual(client.session, null);
    });
    it("returns the same session rather than opening a second socket", () => {
        const { client, sockets } = clientOf([]);
        assert.equal(client.connect(), client.connect());
        assert.equal(sockets.length, 1, "a second socket is a second handshake, not a duplicate");
    });
    it("closes the socket without clearing the token", () => {
        const tokens = storeOf("access-1");
        const { client } = clientOf([], { tokens });
        const session = client.connect();
        client.close();
        assert.equal(session.state, "closed");
        assert.equal(client.session, null);
        assert.equal(tokens.read(), "access-1", "closing a connection is not signing out");
        assert.deepEqual(tokens.writes, [], "teardown wrote nothing");
    });
    it("can reconnect after closing", () => {
        const { client, sockets } = clientOf([]);
        client.connect();
        client.close();
        client.connect();
        assert.equal(sockets.length, 2);
    });
});
describe("closing a session", () => {
    it("is idempotent, because teardown paths run twice", () => {
        const { client } = clientOf([]);
        const session = client.connect();
        session.close();
        session.close();
        const closed = session.events.filter((event) => event.kind === "state" && event.to === "closed");
        assert.equal(closed.length, 1, "the second close was a no-op, not a second teardown");
    });
    it("refuses sends afterwards rather than queueing into a socket nobody flushes", () => {
        const { client } = clientOf([]);
        const session = client.connect();
        session.close();
        assert.throws(() => session.send("chat.message.send"), /closed/);
    });
});
