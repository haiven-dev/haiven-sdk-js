// Questions 2 and 3: does the in-band handshake bind cleanly, and can
// `auth.expired` be answered on the live socket?
//
// These drive the client session against a model of the deployed backend's read
// loop and write pump (src/ws/fake-server.js). Every assertion here is also
// asserted against the real server in live.test.js — the model exists so the
// same paths stay reachable without a Go toolchain, not as an independent
// source of truth. Where the two disagree, the live suite wins.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FakeServerSocket, STATUS_POLICY_VIOLATION } from "../src/ws/fake-server.js";
import { Session, classifyClose, closeMayReconnect, closeRequiresSignIn } from "../src/ws/session.js";
const GOOD = { value: "good-token", userId: "user-1", valid: true };
const OTHER_USER = { value: "other-token", userId: "user-2", valid: true };
const REJECTED = { value: "bad-token", userId: "user-1", valid: false };
const LAPSED = { value: "lapsed-token", userId: "user-1", valid: true, expired: true };
function connect(options = {}) {
    const socket = new FakeServerSocket({
        tokens: options.tokens ?? [GOOD, OTHER_USER, REJECTED, LAPSED],
        rateLimited: options.rateLimited,
        routes: options.routes,
        deferred: options.deferred,
    });
    const session = new Session({
        socket,
        token: options.token ?? (() => GOOD.value),
        vocabulary: ["expired_token", "invalid_token", "rate_limited", "unauthorized"],
    });
    socket.open();
    return { socket, session };
}
const authFrames = (socket) => socket.sent.filter((f) => f.type === "auth");
const framesOfType = (session, type) => session.events.filter((e) => e.kind === "frame" && e.frame.type === type);
describe("the in-band handshake", () => {
    it("makes the socket writable before it is usable", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD] });
        const session = new Session({ socket, token: () => GOOD.value });
        // Before the socket opens there is nothing to authenticate with, yet a
        // caller can already hold the session object and call send().
        session.send("chat.send", { content: "hi" });
        assert.equal(session.state, "pending");
        assert.equal(socket.sent.length, 0, "nothing may reach the wire before auth");
        socket.open();
        assert.equal(session.state, "authenticated");
        assert.equal(socket.sent[0]?.type, "auth", "auth must be the first frame");
        assert.equal(socket.sent[1]?.type, "chat.send", "the queued call follows it");
    });
    it("answers the auth frame with an uncorrelatable reply", () => {
        const { socket, session } = connect();
        const authFrame = socket.sent[0];
        assert.ok(authFrame.requestId, "the client did send a requestId");
        const reply = framesOfType(session, "auth.success")[0];
        assert.ok(reply?.kind === "frame");
        assert.equal(reply.frame.requestId, "", "but the handshake reply discards it");
        assert.notEqual(reply.frame.requestId, authFrame.requestId);
    });
    it("follows it with nothing at all", () => {
        const { session } = connect();
        // promoteConn used to publish user.connected to the user channel and the
        // manager fanned it straight back, so the reply to the handshake was not
        // the last frame of the handshake (F9.2). It is Internal only now (F13),
        // which makes auth.success the whole of what a client is told.
        assert.deepEqual(session.events.filter((e) => e.kind === "frame").map((e) => e.frame.type), ["auth.success"]);
    });
    it("reports a rejected token as a close code, with no error frame", () => {
        const { socket, session } = connect({ token: () => REJECTED.value });
        const frames = session.events.filter((e) => e.kind === "frame");
        assert.equal(frames.length, 0, "no auth.failure frame is ever sent");
        assert.equal(session.state, "closed");
        void socket;
    });
    it("authenticates into an already-expired session, and answers with the lapse", () => {
        // initAuth verifies the token and never consults the session clock, so a
        // token inside the verifier's 30s leeway but past its exp completes the
        // handshake — into a session that is already expired.
        const { socket, session } = connect({ token: () => LAPSED.value });
        // The handshake used to answer auth.success and have it replaced by the
        // pump, so the client heard nothing at all and a binding that leaves
        // `pending` only on auth.success waited forever on a promoted socket. One
        // frame now answers both halves: it is promoted, and it is unusable (F11).
        assert.equal(framesOfType(session, "auth.success").length, 0, "not a success");
        assert.ok(framesOfType(session, "auth.expired").length > 0, "an answer, and a true one");
        assert.equal(session.state, "expired", "the client knows which state it is in");
        // And nothing is lost on the way in any more. The one frame the promoted
        // socket used to drop here was user.connected — a fan-out event rather
        // than an auth-control frame, so the pump held it while everything about
        // the expiry passed. It is no longer sent at all (F13), so the handshake
        // into a lapsed session now costs the client nothing it can observe.
        assert.deepEqual(socket.droppedOutbound, []);
        // The re-auth used the same lapsed token, so nothing tells it to stop.
        assert.equal(authFrames(socket).length, 2);
    });
});
describe("auth.expired", () => {
    it("names the request it refused, correlated, at the moment it happens", () => {
        const { socket, session } = connect();
        socket.expireSession();
        const sent = session.send("chat.send", { content: "hi" });
        // The read loop's answer echoes the requestId. It used to be replaced by
        // the pump's own uncorrelated one before it could be written, so no client
        // ever saw it (F9); it now passes through (F11).
        assert.equal(socket.droppedInbound.length, 1);
        assert.deepEqual(socket.droppedOutbound.map((f) => f.requestId), [], "nothing about the expiry is dropped any more");
        const named = session.events.filter((e) => e.kind === "dropped-request");
        assert.equal(named.length, 1);
        assert.ok(named[0]?.kind === "dropped-request");
        assert.equal(named[0].requestId, sent.requestId, "the client learns which request died");
        assert.equal(named[0].frame?.type, "chat.send");
    });
    it("resends only what the server named, so nothing is lost and nothing duplicated", () => {
        const { socket, session } = connect();
        socket.expireSession();
        session.send("chat.send", { content: "hi" });
        assert.equal(session.state, "authenticated", "recovered without a reconnect");
        assert.equal(authFrames(socket).length, 2, "handshake plus one in-band re-auth");
        // The blind resend is gone. `resending` used to hold everything in flight
        // because the server named none of it; the correlated notice carries that
        // job now, so the episode itself resends nothing on its own account.
        const expiry = session.events.find((e) => e.kind === "expired");
        assert.ok(expiry?.kind === "expired");
        assert.deepEqual(expiry.resending, [], "no request is resent on suspicion");
        const chatFrames = socket.sent.filter((f) => f.type === "chat.send");
        assert.equal(chatFrames.length, 2, "sent once, refused by name, resent after re-auth");
        assert.equal(chatFrames[0].requestId, chatFrames[1].requestId, "same requestId");
        assert.equal(session.droppedRequests.length, 0, "nothing left outstanding");
    });
    it("re-authenticates once per episode, not once per frame", () => {
        const { socket, session } = connect();
        socket.expireSession();
        socket.pushAll(["m1", "m2", "m3"].map((id) => ({
            type: "chat.message",
            requestId: "",
            success: true,
            payload: { id },
        })));
        // One replacement per undeliverable frame — a burst of fan-out arrives as
        // a burst of identical, unactionable frames.
        assert.equal(framesOfType(session, "auth.expired").length, 3);
        assert.equal(authFrames(socket).length, 2, "but the client re-authenticates once");
    });
    it("loses server pushes outright, and the client cannot say what it lost", () => {
        const { socket, session } = connect();
        socket.expireSession();
        socket.push({ type: "chat.message", requestId: "", success: true, payload: { id: "m1" } });
        // The write pump replaced it and discarded it. Nothing re-queues it, and
        // the re-auth below does not replay it.
        assert.deepEqual(socket.droppedOutbound.map((f) => f.payload), [{ id: "m1" }]);
        assert.equal(framesOfType(session, "chat.message").length, 0);
        assert.equal(session.events.filter((e) => e.kind === "dropped-report").length, 0, "and the deployed server sends no loss report");
        // The loss window is bounded only because the client re-authenticates on
        // its own initiative; the server never asked it to.
        assert.equal(session.state, "authenticated");
    });
    it("keeps losing pushes for as long as re-auth cannot succeed", () => {
        // A refresh that fails — the realistic case, since the token expiring
        // mid-session and the refresh being rejected have the same root causes.
        const socket = new FakeServerSocket({ tokens: [GOOD, REJECTED] });
        let first = true;
        const session = new Session({
            socket,
            token: () => {
                if (first) {
                    first = false;
                    return GOOD.value;
                }
                return REJECTED.value;
            },
            vocabulary: ["expired_token", "invalid_token"],
        });
        socket.open();
        socket.expireSession();
        for (const id of ["m1", "m2", "m3"]) {
            socket.push({ type: "chat.message", requestId: "", success: true, payload: { id } });
        }
        assert.equal(socket.droppedOutbound.filter((f) => f.type === "chat.message").length, 3, "every push in the window is lost");
        assert.equal(session.state, "expired", "connected, authenticated for nothing");
        // The client re-authenticated exactly once. Nothing in the protocol tells
        // it when to try again, so a retry policy is a decision every binding
        // invents for itself.
        assert.equal(authFrames(socket).length, 2);
    });
});
describe("auth.expired.dropped", () => {
    /**
     * An episode in the shape the loss report is about: three requests accepted
     * while the session was usable, answered after it was not.
     *
     * The deployed pump discards those answers outright, so the report is a
     * control lever here rather than modelled behaviour — `reportDropped` says
     * why. What matters for the binding is the timing, and that is real: the
     * report arrives *after* the `auth.success` that ended the episode.
     */
    function overflowed() {
        const routes = new Set(["chat.send"]);
        const { socket, session } = connect({ routes, deferred: routes });
        const inFlight = [
            session.send("chat.send", { id: "a" }),
            session.send("chat.send", { id: "b" }),
            session.send("chat.send", { id: "c" }),
        ];
        socket.expireSession();
        socket.answerDeferred();
        // The client learns of the lapse the way an actively-sending one does — by
        // being refused — and recovers on the same socket. An unrouted type, so
        // the resend is answered inline and leaves nothing outstanding of its own.
        session.send("probe");
        assert.equal(session.state, "authenticated", "recovered before the report arrives");
        return { socket, session, inFlight };
    }
    const resends = (socket, requestId) => socket.sent.filter((f) => f.requestId === requestId).length;
    it("resends the requests the report names, and nothing else", () => {
        const { socket, session, inFlight } = overflowed();
        socket.reportDropped({
            count: 2,
            types: [{ type: "chat.send", count: 2 }],
            requestIds: [inFlight[0].requestId, inFlight[1].requestId],
            truncated: false,
        });
        const named = session.events.filter((e) => e.kind === "dropped-request");
        assert.deepEqual(named.map((e) => (e.kind === "dropped-request" ? e.requestId : "")), [inFlight[0].requestId, inFlight[1].requestId]);
        assert.equal(resends(socket, inFlight[0].requestId), 2, "named, so resent");
        assert.equal(resends(socket, inFlight[1].requestId), 2, "named, so resent");
        assert.equal(resends(socket, inFlight[2].requestId), 1, "not named, so still parked for replay — resending it would duplicate it");
        // FORCED by the timing: the report arrives after the auth.success that
        // released the replay, so a binding that only re-queues would sit on these
        // until the *next* expiry.
        assert.equal(session.droppedRequests.length, 0, "sent now, not queued for a re-auth");
        assert.equal(session.state, "authenticated");
    });
    it("falls back to the blind resend only when the report says it must", () => {
        const { socket, session, inFlight } = overflowed();
        socket.reportDropped({
            count: 3,
            types: [{ type: "chat.send", count: 3 }],
            requestIds: [inFlight[0].requestId],
            truncated: true,
        });
        const blind = session.events.find((e) => e.kind === "resending-blind");
        assert.ok(blind?.kind === "resending-blind");
        assert.deepEqual(blind.resending.map((f) => f.requestId), [inFlight[1].requestId, inFlight[2].requestId], "everything still unanswered, and only that");
        for (const frame of inFlight) {
            assert.equal(resends(socket, frame.requestId), 2, "named or suspected, either way resent");
        }
    });
    it("does not resend a request the server already answered", () => {
        // The map behind `truncated` has to forget an answered request. It did not
        // until this case existed to read it, because every other reader looked up
        // one id at a time.
        const routes = new Set(["chat.send"]);
        const { socket, session } = connect({ routes });
        const answered = session.send("chat.send", { id: "answered" });
        assert.equal(framesOfType(session, "chat.send").length, 1, "the server replied inline");
        socket.reportDropped({ count: 1, types: [], requestIds: [], truncated: true });
        const blind = session.events.find((e) => e.kind === "resending-blind");
        assert.ok(blind?.kind === "resending-blind");
        assert.deepEqual(blind.resending, [], "nothing is outstanding");
        assert.equal(resends(socket, answered.requestId), 1, "sent once, and once only");
    });
});
describe("re-auth failure", () => {
    it("is reportable while the session is expired — the very case it matters in", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD, REJECTED] });
        let first = true;
        const session = new Session({
            socket,
            token: () => {
                if (first) {
                    first = false;
                    return GOOD.value;
                }
                return REJECTED.value;
            },
            vocabulary: ["expired_token", "invalid_token"],
        });
        socket.open();
        socket.expireSession();
        session.send("chat.send", {});
        // The pump used to replace this with another auth.expired, so a client
        // whose refresh was dead saw only more lapse notices and could never learn
        // why. Nothing about the expiry is dropped now (F11).
        assert.deepEqual(socket.droppedOutbound.map((f) => [f.type, f.error]), []);
        const failure = framesOfType(session, "auth.failure")[0];
        assert.ok(failure?.kind === "frame", "the reason the refresh failed arrives");
        assert.equal(failure.frame.error?.value, "invalid_token");
        // And the binding acts on it differently: a dead refresh is surfaced
        // rather than retried, because retrying the same token cannot work.
        const reported = session.events.find((e) => e.kind === "refresh-failed");
        assert.ok(reported?.kind === "refresh-failed");
        assert.equal(reported.code?.value, "invalid_token");
        assert.equal(session.state, "expired");
    });
    it("is a frame, not a close, when the session has not expired", () => {
        // The same logical failure as the handshake test — a token the server will
        // not accept — reported completely differently because the socket is
        // already live and usable.
        const socket = new FakeServerSocket({ tokens: [GOOD, REJECTED] });
        const session = new Session({
            socket,
            token: () => GOOD.value,
            vocabulary: ["invalid_token", "unauthorized"],
        });
        socket.open();
        socket.send(JSON.stringify({ type: "auth", requestId: "manual-1", payload: REJECTED.value }));
        const failure = framesOfType(session, "auth.failure")[0];
        assert.ok(failure?.kind === "frame", "a frame, not a close");
        assert.equal(failure.frame.error?.value, "invalid_token");
        assert.equal(failure.frame.requestId, "manual-1", "and this one does correlate");
        assert.notEqual(session.state, "closed", "the socket is not closed, unlike the handshake path");
    });
    it("rejects a token for a different user without closing the socket", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD, OTHER_USER] });
        const session = new Session({
            socket,
            token: () => GOOD.value,
            vocabulary: ["unauthorized"],
        });
        socket.open();
        socket.send(JSON.stringify({ type: "auth", requestId: "manual-2", payload: OTHER_USER.value }));
        const failure = framesOfType(session, "auth.failure")[0];
        assert.ok(failure?.kind === "frame");
        assert.equal(failure.frame.error?.value, "unauthorized");
        assert.notEqual(session.state, "closed");
    });
});
describe("routing and rate limiting", () => {
    it("is announced only as an error frame, with no budget to back off against", () => {
        const { socket, session } = connect({ rateLimited: new Set(["chat.send"]) });
        const sent = session.send("chat.send", { content: "hi" });
        const answer = session.events.find((e) => e.kind === "frame" && e.frame.requestId === sent.requestId);
        assert.ok(answer?.kind === "frame");
        assert.equal(answer.frame.error?.value, "rate_limited");
        assert.equal(answer.frame.type, "chat.send", "this one *does* echo the request type");
        // Nothing on the frame says how long to wait or how much budget is left,
        // so every binding has to invent its own backoff.
        assert.deepEqual(Object.keys(answer.frame).sort(), [
            "error",
            "requestId",
            "success",
            "type",
        ]);
        void socket;
    });
    it("answers a ping in the reply envelope, correlated to the ping", () => {
        const { socket, session } = connect();
        session.send("ping");
        const pong = framesOfType(session, "pong")[0];
        assert.ok(pong?.kind === "frame");
        assert.deepEqual(Object.keys(pong.frame).sort(), ["requestId", "success", "type"]);
        assert.ok(pong.frame.requestId, "the pong names the ping it answers");
        assert.equal(pong.frame.success, true);
        void socket;
    });
});
describe("close semantics", () => {
    it("uses a policy-violation close for an unauthenticated socket", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD] });
        let closeCode;
        const session = new Session({ socket, token: () => "not-a-known-token" });
        socket.onclose = ((original) => (event) => {
            closeCode = event.code;
            original?.(event);
        })(socket.onclose);
        socket.open();
        assert.equal(closeCode, STATUS_POLICY_VIOLATION);
        assert.equal(session.state, "closed");
    });
    it("classifies a refused handshake as a refused credential", () => {
        const { session } = connect({ token: () => REJECTED.value });
        assert.deepEqual(session.lastClose, {
            code: STATUS_POLICY_VIOLATION,
            reason: "unauthorized",
            kind: "credential_refused",
        });
        assert.equal(closeRequiresSignIn(session.lastClose.kind), true);
        assert.equal(closeMayReconnect(session.lastClose.kind), false);
    });
    it("classifies a revoked game credential, and keeps it readable from the closed callback", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD] });
        let seen;
        const session = new Session({
            socket,
            token: () => GOOD.value,
            onEvent: (event) => {
                if (event.kind === "state" && event.to === "closed")
                    seen = session.lastClose?.kind;
            },
        });
        socket.open();
        assert.equal(session.state, "authenticated");
        assert.equal(session.lastClose, undefined, "an open session has not closed");
        socket.close(STATUS_POLICY_VIOLATION, "credential_revoked");
        assert.equal(seen, "credential_revoked");
        assert.equal(closeRequiresSignIn("credential_revoked"), true);
        assert.equal(closeMayReconnect("credential_revoked"), false);
    });
    it("treats a dropped connection as one the credential survives", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD] });
        const session = new Session({ socket, token: () => GOOD.value });
        socket.open();
        socket.close(1006, "");
        assert.equal(session.lastClose?.kind, "transport");
        assert.equal(closeRequiresSignIn("transport"), false);
        assert.equal(closeMayReconnect("transport"), true);
    });
    it("reports the caller's own close as a transport close, and ignores the echo", () => {
        const socket = new FakeServerSocket({ tokens: [GOOD] });
        const session = new Session({ socket, token: () => GOOD.value });
        socket.open();
        session.close();
        assert.deepEqual(session.lastClose, { code: 1000, reason: "", kind: "transport" });
    });
    it("classifies a close by its code and reason alone", () => {
        for (const [code, reason, kind] of [
            [1008, "unauthorized", "credential_refused"],
            [1008, "credential_revoked", "credential_revoked"],
            [1008, "parental_consent_denied", "policy"],
            [1008, "minted_after_this_build", "policy"],
            [1000, "", "transport"],
            [1001, "going away", "transport"],
            [1011, "internal_error", "transport"],
            // A reason is only meaningful under 1008; the same text on another code is a transport close.
            [1000, "credential_revoked", "transport"],
        ]) {
            assert.equal(classifyClose(code, reason), kind, `${code} ${reason}`);
            assert.equal(closeMayReconnect(kind), kind === "transport");
        }
    });
});
