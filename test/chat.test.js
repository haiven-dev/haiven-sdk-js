// Headless chat keeps a send across a lost socket, under the same client message
// id. The same rules as the .NET HaivenChat and the C++ FChatCore.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HaivenChat, outgoingStateFor } from "../src/chat.js";
import { Session } from "../src/ws/session.js";
class RecordingSocket {
    sent = [];
    onmessage = null;
    onclose = null;
    onerror = null;
    onopen = null;
    send(data) {
        this.sent.push(JSON.parse(data));
    }
    close() { }
    receive(frame) {
        this.onmessage?.({ data: JSON.stringify(frame) });
    }
    drop() {
        this.onclose?.({ code: 1006, reason: "network" });
    }
    sends() {
        return this.sent.filter((frame) => frame.type === "chat.send");
    }
}
/** A session wired to the chat, as a game wires it: the chat receives every event. */
function connect(chat, prefix) {
    const socket = new RecordingSocket();
    let next = 0;
    const session = new Session({
        socket,
        token: () => "token",
        requestId: () => `${prefix}${++next}`,
        retainEvents: false,
        onEvent: (event) => chat.handle(event),
    });
    chat.attach(session);
    socket.onopen?.();
    socket.receive({ type: "auth.success", requestId: "", success: true });
    return { socket, session };
}
function clientIdOf(frame) {
    return frame.payload.clientMessageId;
}
describe("headless chat", () => {
    it("keeps a send across a lost socket and resends it under the same id", () => {
        let ids = 0;
        const received = [];
        const chat = new HaivenChat({ clientMessageId: () => `cm-${++ids}`, onMessage: (m) => received.push(m) });
        const detached = chat.send("ch-1", "before any session");
        assert.equal(detached.state, "unconfirmed", "a send with no session is kept, not thrown");
        const first = connect(chat, "a-");
        assert.equal(first.socket.sends().length, 1, "attaching resends the unconfirmed message after auth");
        assert.equal(clientIdOf(first.socket.sends()[0]), "cm-1");
        first.socket.receive({
            type: "chat.send", requestId: first.socket.sends()[0].requestId, success: true,
            payload: { message: { id: "m-1", channelId: "ch-1" }, moderationState: "allowed" },
        });
        assert.equal(detached.state, "accepted");
        assert.equal(detached.messageId, "m-1");
        const held = chat.send("ch-1", "held");
        first.socket.receive({
            type: "chat.send", requestId: first.socket.sends()[1].requestId, success: true,
            payload: { message: { id: "m-2", channelId: "ch-1" }, moderationState: "pending" },
        });
        assert.equal(held.state, "held");
        const lost = chat.send("ch-1", "reply lost");
        first.socket.drop();
        assert.equal(lost.state, "unconfirmed", "a send unanswered at close is unconfirmed");
        assert.equal(detached.state, "accepted", "and a finished one is not touched");
        const second = connect(chat, "b-");
        assert.equal(second.socket.sends().length, 1, "the next session resends only the unconfirmed message");
        assert.equal(clientIdOf(second.socket.sends()[0]), lost.clientMessageId);
        second.socket.receive({ type: "chat.send", requestId: second.socket.sends()[0].requestId, success: false, error: "content_too_long" });
        assert.equal(lost.state, "refused");
        assert.equal(lost.error, "content_too_long");
        second.socket.receive({ type: "chat.message", payload: { id: "m-9", channelId: "ch-1", content: "hi" } });
        assert.equal(received.length, 1);
        assert.equal(received[0].content, "hi");
        chat.forget(detached);
        assert.ok(!chat.outbox.includes(detached));
    });
    it("reads an unknown moderation state as held, never as visible", () => {
        assert.equal(outgoingStateFor("quarantined"), "held");
        assert.equal(outgoingStateFor(undefined), "held");
        assert.equal(outgoingStateFor("blocked"), "removed");
        assert.equal(outgoingStateFor("warned"), "accepted");
    });
    it("sends a reply's parent and never resends typing", () => {
        const chat = new HaivenChat({ clientMessageId: () => "cm-r" });
        const { socket } = connect(chat, "r-");
        chat.send("ch-1", "a reply", "m-parent");
        chat.sendTyping("ch-1");
        const payload = socket.sends()[0].payload;
        assert.equal(payload.parentMessageId, "m-parent");
        assert.equal(socket.sent.filter((frame) => frame.type === "chat.typing").length, 1);
    });
    it("reads a game socket's forbidden reply as a refusal and keeps the session", () => {
        // A socket opened with a game credential refuses every operation not
        // declared for games with `forbidden` (haiven-api websocket.md, Game
        // sockets). That is final for the message, not for the session, and the
        // next socket must not resend it.
        const chat = new HaivenChat({ clientMessageId: () => "cm-f" });
        const first = connect(chat, "f-");
        const message = chat.send("ch-1", "community chat from a game");
        first.socket.receive({ type: "chat.send", requestId: first.socket.sends()[0].requestId, success: false, error: "forbidden" });
        assert.equal(message.state, "refused");
        assert.equal(message.error, "forbidden");
        assert.equal(first.session.state, "authenticated");
        first.socket.drop();
        const second = connect(chat, "g-");
        assert.equal(second.socket.sends().length, 0, "a refused message is never resent");
    });
    it("keeps a send across a correlated auth.expired and applies the resent reply", () => {
        const chat = new HaivenChat({ clientMessageId: () => "cm-e" });
        const { socket } = connect(chat, "e-");
        const message = chat.send("ch-1", "during lapse");
        const requestId = socket.sends()[0].requestId;
        socket.receive({
            type: "auth.expired",
            requestId,
            success: false,
            error: "expired_token",
        });
        assert.equal(message.state, "sending", "auth.expired is not a chat refusal");
        assert.equal(message.error, undefined);
        const reauth = socket.sent.filter((frame) => frame.type === "auth").at(-1);
        assert.ok(reauth, "the session reauthenticates on the same socket");
        socket.receive({ type: "auth.success", requestId: reauth.requestId, success: true });
        assert.equal(socket.sends().length, 2, "the named send is resent after reauthentication");
        assert.equal(socket.sends()[1].requestId, requestId);
        assert.equal(clientIdOf(socket.sends()[1]), "cm-e");
        socket.receive({
            type: "chat.send",
            requestId,
            success: true,
            payload: { message: { id: "m-e", channelId: "ch-1" }, moderationState: "allowed" },
        });
        assert.equal(message.state, "accepted");
        assert.equal(message.messageId, "m-e");
    });
});
