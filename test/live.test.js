// The socket scenarios, run against a live backend rather than a model of one.
//
// `../src/ws/live.js` builds and runs `backend/cmd/wsfixture`, which is the real
// websocket stack — handler, manager, cache subscriber, router, read loop, write
// pump — with only the identity provider, one user row and the pub/sub broker
// stubbed. Nothing about the protocol is stubbed, so a failure here is a claim
// about the server, not about a fixture.
//
// Skipped, with a reason, when the backend checkout or the Go toolchain is
// missing. The model-driven suite in auth.test.js must stay runnable alone.
//
// The two expired-session behaviours are covered separately because the backend
// has two. `origin/main` discards outbound frames while a session is expired;
// `fix/ws-expired-message-loss` parks and replays them. The fixture reports
// which one it is running by publishing `pendingLimit`, so this file asserts the
// invariants both share and then the ones only one of them has.
//
// The auth-control assertions are NOT split that way. F11 (pass auth.expired,
// auth.failure and auth.success through the pump) landed on the same branch as
// the parking behaviour, so a backend without it fails those tests rather than
// selecting a second path — which is the point: they describe a defect that was
// fixed, not a difference to accommodate.
import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { LiveClient, LiveFixture, liveUnavailable } from "../src/ws/live.js";
import { Session } from "../src/ws/session.js";
const unavailable = await liveUnavailable();
describe("the live socket", { skip: unavailable, timeout: 120_000 }, () => {
    let fx;
    before(async () => {
        fx = await LiveFixture.start();
    });
    after(async () => {
        await fx?.stop();
    });
    /** Parks and replays outbound frames instead of discarding them. */
    const parks = () => fx.info.pendingLimit > 0;
    /**
     * A client authenticated with a token that is valid and unexpired, settled
     * and with its frame log cleared so a test reads only its own traffic.
     */
    async function authenticated() {
        const client = await fx.client();
        client.send({ type: "auth", requestId: "handshake", payload: await fx.token("1h") });
        await client.until((f) => f.type === "auth.success");
        await client.quiesce(200);
        client.reset();
        return client;
    }
    /**
     * A client whose session is expired from its first instruction.
     *
     * The token is past its `exp` but inside the verifier's 30s leeway, so it
     * verifies while the session it mints does not. `initAuth` never consults the
     * session clock, so the handshake completes — and every frame the server then
     * writes meets an expired session.
     */
    async function expired() {
        const client = await fx.client();
        client.send({ type: "auth", requestId: "handshake", payload: await fx.token("-1s") });
        await client.until((f) => f.type === "auth.expired");
        await client.quiesce(200);
        client.reset();
        return client;
    }
    describe("the handshake", () => {
        it("answers with an auth.success that names the request it answers", async () => {
            const client = await fx.client();
            client.send({ type: "auth", requestId: "rq-handshake", payload: await fx.token("1h") });
            const reply = await client.next();
            assert.equal(reply.type, "auth.success");
            assert.equal(reply.success, true);
            assert.equal(reply.requestId, "rq-handshake", "the surface-major negotiation made this a correlated reply");
            client.close();
        });
        it("follows it with nothing", async () => {
            const client = await fx.client();
            client.send({ type: "auth", requestId: "rq-handshake", payload: await fx.token("1h") });
            await client.next();
            // promoteConn used to publish user.connected to `user:<id>` and the
            // manager's own subscriber fanned it back here, so every client got an
            // unsolicited payload-less frame about itself (F9.2). Measured against
            // the live fixture, which is what found it in the first place: the
            // event is Internal only now, so the handshake reply is the last frame
            // of the handshake.
            await client.quiesce(750);
            assert.deepEqual(client.frames.slice(1), [], "the handshake reply is the whole handshake");
            client.close();
        });
        it("closes with 1008 and no frame when the token is rejected", async () => {
            const client = await fx.client();
            client.send({ type: "auth", requestId: "rq-1", payload: "not-a-jwt" });
            const close = await client.closed;
            assert.equal(close.code, 1008);
            assert.equal(close.reason, "unauthorized");
            assert.deepEqual(client.frames, [], "no auth.failure on this path");
        });
        it("closes with 1008 when the first frame is not an auth frame", async () => {
            const client = await fx.client();
            client.send({ type: "ping", requestId: "rq-1", payload: "x" });
            const close = await client.closed;
            assert.equal(close.code, 1008);
            assert.deepEqual(client.frames, []);
        });
        it("dies without a close frame when no frame arrives at all", async () => {
            const client = await fx.client();
            const started = Date.now();
            const close = await client.closed;
            // The read deadline elapses and the context cancel tears the socket
            // down; there is no server close frame, so this is 1006 rather than
            // the 1008 every other handshake failure gets.
            assert.equal(close.code, 1006);
            assert.ok(Date.now() - started >= 4_500, "after the 5s deadline, not immediately");
        });
    });
    describe("an expired session", () => {
        it("answers a handshake into a lapsed session with the lapse, not a success", async () => {
            const client = await fx.client();
            client.send({ type: "auth", requestId: "handshake", payload: await fx.token("-1s") });
            await client.until((f) => f.type === "auth.expired");
            await client.quiesce(300);
            // The socket is genuinely promoted — but it will refuse everything, so
            // auth.success would be a lie the client cannot detect until its first
            // request comes back refused. It used to answer auth.success and have
            // the pump replace it, which left the client hearing nothing at all.
            assert.equal(client.frames.filter((f) => f.type === "auth.success").length, 0, "a promoted socket the server will refuse is not a success");
            for (const frame of client.frames) {
                assert.equal(frame.type, "auth.expired");
                assert.equal(frame.requestId, "handshake", "the lapse names the handshake it refuses");
                assert.equal(frame.error, "expired_token");
            }
            client.close();
        });
        it("answers a client frame with a correlated auth.expired, and never processes it", async () => {
            const client = await expired();
            client.send({ type: "ping", requestId: "rq-ping" });
            const answer = await client.until((f) => f.type === "auth.expired");
            assert.equal(client.frames.filter((f) => f.type === "pong").length, 0, "the ping is answered and then abandoned");
            // The read loop's answer used to be replaced by the pump's own
            // uncorrelated one, so a client learned that something had failed but
            // never which of its requests. It now arrives, by name (F11).
            assert.equal(answer.requestId, "rq-ping", "it names the request that died");
            assert.equal(answer.error, "expired_token");
            // The frame is still not run: the read loop dropped it with `continue`,
            // so re-authenticating does not dispatch it either. Naming it is what
            // lets the client resend exactly this one.
            client.reset();
            client.send({ type: "auth", requestId: "rq-reauth", payload: await fx.token("1h") });
            await client.quiesce(600);
            assert.equal(client.frames.filter((f) => f.type === "pong").length, 0, "still never processed");
            client.close();
        });
        it("recovers on the same socket, with an auth.success that does echo the request id", async () => {
            const client = await expired();
            client.send({ type: "auth", requestId: "rq-reauth", payload: await fx.token("1h") });
            const reply = await client.until((f) => f.type === "auth.success");
            assert.equal(reply.requestId, "rq-reauth", "unlike the handshake, this one correlates");
            assert.equal(reply.success, true);
            client.close();
        });
        it("rejects a re-auth for a different user without closing the socket", async () => {
            const client = await authenticated();
            const res = await fetch(`${fx.info.baseUrl}/control/token?ttl=1h&sub=${crypto.randomUUID()}`);
            const other = (await res.json()).token;
            client.send({ type: "auth", requestId: "rq-other", payload: other });
            const reply = await client.until((f) => f.type === "auth.failure");
            assert.equal(reply.error, "unauthorized");
            assert.equal(reply.requestId, "rq-other");
            assert.equal(client.closeCode, undefined, "the socket stays open");
            client.close();
        });
        it("separates a bad token from a bad payload on the auth frame", async () => {
            const client = await authenticated();
            client.send({ type: "auth", requestId: "rq-badpayload", payload: { not: "a string" } });
            assert.equal((await client.until((f) => f.type === "auth.failure")).error, "invalid_payload");
            client.send({ type: "auth", requestId: "rq-badtoken", payload: "nope" });
            assert.equal((await client.until((f) => f.type === "auth.failure")).error, "invalid_token");
            client.close();
        });
    });
    describe("rate limiting", () => {
        it("answers with the client's own frame type and no budget at all", async () => {
            const client = await authenticated();
            // NewRouter mounts ping with a burst of 5 and a refill of one per 30s.
            for (let i = 0; i < 7; i++)
                client.send({ type: "ping", requestId: `p-${i}` });
            await client.quiesce(500);
            const limited = client.frames.filter((f) => f.error === "rate_limited");
            assert.ok(limited.length > 0, "the bucket is observable only by exhausting it");
            assert.equal(limited[0].type, "ping", "the reply carries the request's type");
            assert.equal(limited[0].success, false);
            // retryAfterMs is the budget: the RetryRule on ping declares RetryAfter, so a
            // rate-limited reply tells the client when to come back rather than leaving it
            // to guess. Everything else is still absent -- no bucket state, no quota.
            assert.deepEqual(Object.keys(limited[0]).sort(), ["error", "requestId", "retryAfterMs", "success", "type"]);
            client.close();
        });
        it("answers a ping with a correlated reply", async () => {
            const client = await authenticated();
            client.send({ type: "ping", requestId: "rq-ping" });
            const pong = await client.until((f) => f.type === "pong");
            assert.deepEqual(Object.keys(pong).sort(), ["requestId", "success", "type"], "the same reply envelope as every other answer, and no payload key");
            assert.equal(pong.requestId, "rq-ping", "the pong names the ping it answers");
            assert.equal(pong.success, true);
            client.close();
        });
    });
    describe("what an expired session costs the client", () => {
        it("reports the loss the way this backend reports it", async () => {
            const client = await expired();
            await fx.push({ type: "chat.message", payload: { id: "m1" } });
            await fx.push({ type: "chat.message", payload: { id: "m2" } });
            await fx.push({ type: "chat.message", payload: { id: "m3" } });
            await client.quiesce(600);
            const during = [...client.frames];
            if (parks()) {
                // The announcement is one per expiry episode, and it was already
                // spent on the handshake reply this session never received.
                assert.deepEqual(during, [], "an expired session is silent after the first notice");
            }
            else {
                assert.equal(during.length, 3, "one replacement per undeliverable frame");
                for (const frame of during) {
                    assert.equal(frame.type, "auth.expired");
                    assert.equal(frame.requestId, "", "with nothing to say which message was lost");
                }
            }
            client.reset();
            client.send({ type: "auth", requestId: "rq-reauth", payload: await fx.token("1h") });
            await client.quiesce(900);
            const replayed = client.frames.filter((f) => f.type === "chat.message");
            if (parks()) {
                assert.deepEqual(replayed.map((f) => f.payload.id), ["m1", "m2", "m3"], "parked oldest-first and replayed after the auth.success that released them");
            }
            else {
                assert.deepEqual(replayed, [], "nothing re-queues them; re-auth does not replay them");
            }
            client.close();
        });
        it("reports a failed refresh as a failure, while the session is expired", async () => {
            const client = await expired();
            client.send({ type: "auth", requestId: "rq-bad", payload: "nope" });
            const failure = await client.until((f) => f.type === "auth.failure");
            // This is the one failure a client must handle differently — a revoked
            // or malformed refresh token cannot be retried into working — and it
            // used to be the one it could never see, because the pump replaced it
            // with another auth.expired (F9.4, fixed in F11).
            assert.equal(failure.error, "invalid_token", "not another expiry notice");
            assert.equal(failure.requestId, "rq-bad", "correlated to the refresh that failed");
            assert.equal(failure.success, false);
            client.close();
        });
        it("names what it discarded, when it discards anything", async (t) => {
            if (!parks()) {
                t.skip("this backend discards every outbound frame and reports no detail");
                return;
            }
            const client = await expired();
            // Overflow the bound: what survives is the newest, and the oldest are
            // counted into the report.
            await fx.push({ type: "chat.message", payload: { id: "x" }, count: fx.info.pendingLimit + 3 });
            await client.quiesce(700);
            client.reset();
            client.send({ type: "auth", requestId: "rq-reauth", payload: await fx.token("1h") });
            await client.quiesce(1_500);
            const after = [...client.frames];
            const report = after.find((f) => f.type === "auth.expired.dropped");
            assert.ok(report, "the loss is reported");
            const payload = report.payload;
            assert.ok(payload.count > 0);
            assert.equal(payload.types.reduce((sum, t) => sum + t.count, 0), payload.count, "the per-type breakdown accounts for the whole count");
            // Everything parked here is a fan-out event, so the report names the
            // content type rather than anything about the session. It used to be
            // able to name auth.success (auth-control frames no longer park, F11)
            // and user.connected (no longer sent at all, F13).
            assert.deepEqual(payload.types.map((t) => t.type), ["chat.message"]);
            assert.ok(!payload.types.some((t) => t.type.startsWith("auth.") || t.type.startsWith("user.")), "never an auth frame, which is delivered rather than held, and never a life cycle one");
            assert.ok(after.findIndex((f) => f.type === "auth.expired.dropped") <
                after.findIndex((f) => f.type === "chat.message"), "the gap is reported before the frames that survived it");
            // Nothing correlated was lost here — every dropped frame was a fan-out
            // event — and the report says exactly that rather than leaving it out.
            assert.deepEqual(payloadIds(report), [], "an empty list, not an absent field");
            assert.equal(report.payload.truncated, false);
            client.close();
        });
        it("names the requests whose replies it discarded", async (t) => {
            if (!parks()) {
                t.skip("this backend discards every outbound frame and reports no detail");
                return;
            }
            const client = await expired();
            // The rate-limit gate runs BEFORE the expiry gate, so a client retrying
            // into a lapsed session is answered `rate_limited` on its own frame type
            // — a correlated reply, and not auth-control, so it parks. `ping` is the
            // one route NewRouter mounts, at a burst of 5. This is the live shape of
            // the case the report exists for: an answer to a request the client
            // sent, discarded past the bound.
            // One fan-out event ahead of them, so the buffer holds both kinds and
            // the bound evicts the uncorrelated frame first. The handshake's
            // user.connected used to play this part for free; it is not sent any
            // more (F13), so the case has to be set up rather than inherited.
            await fx.push({ type: "chat.message", payload: { id: "ahead" }, count: 1 });
            await client.quiesce(300);
            const budget = 5;
            const correlated = 3;
            for (let i = 0; i < budget + correlated; i++) {
                client.send({ type: "ping", requestId: `rq-ping-${i}` });
            }
            await client.quiesce(700);
            // Fill the buffer behind them so the parked replies are the oldest, and
            // therefore the ones the bound evicts.
            await fx.push({ type: "chat.message", payload: { id: "y" }, count: fx.info.pendingLimit });
            await client.quiesce(700);
            client.reset();
            client.send({ type: "auth", requestId: "rq-reauth", payload: await fx.token("1h") });
            await client.quiesce(1_500);
            const report = client.frames.find((f) => f.type === "auth.expired.dropped");
            assert.ok(report, "the loss is reported");
            assert.deepEqual(payloadIds(report), ["rq-ping-5", "rq-ping-6", "rq-ping-7"], "the client can name which requests will never be answered, oldest first");
            assert.equal(report.payload.truncated, false, "and the list is complete");
            // The first five pings were inside the budget, so they met the expiry
            // gate instead, were answered by name and delivered (F11), and are not
            // in the report at all.
            //
            // The chat.message parked ahead of them was evicted with them. It answers
            // no request, so it is in the count and the type breakdown and NOT in the
            // ids — which is exactly the split the two halves of this payload are for:
            // everything that was lost, and the part of it a client can act on.
            assert.deepEqual(report.payload.types, [
                { type: "chat.message", count: 1 },
                { type: "ping", count: correlated },
            ], "in eviction order, so the breakdown reads oldest-first like the ids do");
            assert.equal(report.payload.count, correlated + 1);
            client.close();
        });
    });
    describe("the client session, driven over a real socket", () => {
        it("binds the handshake, the expiry and the recovery with no reconnect", async () => {
            const socket = fx.socket();
            const tokens = [await fx.token("-1s"), await fx.token("1h")];
            let issued = 0;
            const session = new Session({
                socket,
                token: () => tokens[Math.min(issued++, tokens.length - 1)],
                vocabulary: ["expired_token", "invalid_token", "rate_limited", "unauthorized"],
            });
            await waitFor(() => session.state === "authenticated", 5_000);
            // One socket throughout: the server never asked for a reconnect and
            // the binding never opened one.
            assert.equal(session.state, "authenticated");
            assert.equal(issued, 2, "the handshake token, then the refreshed one");
            const expiries = session.events.filter((e) => e.kind === "expired");
            assert.equal(expiries.length, 1, "one re-auth per episode, not one per frame");
            socket.close();
        });
        it("leaves nothing outstanding, because the server names what it refused", async () => {
            const socket = fx.socket();
            const tokens = [await fx.token("-1s"), await fx.token("1h")];
            let issued = 0;
            const session = new Session({
                socket,
                token: () => tokens[Math.min(issued++, tokens.length - 1)],
                vocabulary: ["expired_token", "unknown_message_type"],
            });
            // Queued while pending, written the moment the session becomes usable.
            session.send("ping");
            await waitFor(() => session.state === "authenticated", 5_000);
            await waitFor(() => session.events.some((e) => e.kind === "frame" && e.frame.type === "pong"), 5_000);
            assert.equal(session.droppedRequests.length, 0, "nothing left outstanding");
            socket.close();
        });
    });
});
/** The correlated half of a loss report: which requests died with the session. */
function payloadIds(report) {
    return report.payload.requestIds;
}
async function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error("condition not met within timeout");
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
