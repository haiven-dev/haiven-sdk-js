// Headless chat over the session: send, receive and typing, with no UI.
// The TypeScript counterpart of the .NET core's HaivenChat and the
// C++ FChatCore, with the same rules, so a game behaves the same on every target.
//
// A session is one socket, so this outlives sessions: `attach` each session the
// game opens, including after a reconnect, and forward that session's events to
// `handle`. Every send carries a client message id. A send still unanswered when
// its socket closes becomes `unconfirmed`, and the next `attach` resends it under
// the same id, which haiven-api deduplicates (haiven-api #645), so a lost reply
// never becomes a lost or doubled message. Nothing here throws on a network
// failure: a send without a usable session is kept and resent on attach.
/** A moderation state minted after this build reads as held, never as visible. */
export function outgoingStateFor(moderationState) {
    switch (moderationState) {
        case "allowed":
        case "warned":
            return "accepted";
        case "hidden":
        case "blocked":
            return "removed";
        default:
            return "held";
    }
}
export class HaivenChat {
    newClientMessageId;
    options;
    messages = [];
    // The request each in-flight send went out under, on the attached session.
    byRequestId = new Map();
    session;
    constructor(options = {}) {
        this.options = options;
        this.newClientMessageId = options.clientMessageId ?? (() => crypto.randomUUID());
    }
    /** Messages this player sent, oldest first, until `forget`. */
    get outbox() {
        return this.messages;
    }
    /** Uses this session from now on, and resends every unconfirmed message through it. */
    attach(session) {
        this.session = session;
        this.byRequestId.clear();
        for (const message of this.messages) {
            if (message.state === "unconfirmed")
                this.write(message);
        }
    }
    /** Forward each event of the attached session here (the session's `onEvent`). */
    handle(event) {
        if (event.kind === "state" && event.to === "closed") {
            this.closed();
            return;
        }
        if (event.kind !== "frame")
            return;
        const frame = event.frame;
        // Only a chat.send reply settles a send. A correlated auth.expired
        // carries success false and this request id, and Session emits that
        // frame before it queues the send for resend. Settling it would drop
        // the correlation, so the reply after reauthentication is ignored.
        if (frame.type === "chat.send" && frame.success !== undefined) {
            this.reply(frame.requestId, frame.success, frame.error?.value, frame.payload);
            return;
        }
        switch (frame.type) {
            case "chat.message":
                this.options.onMessage?.(frame.payload);
                return;
            case "chat.message.updated":
                this.options.onMessageUpdated?.(frame.payload);
                return;
            case "chat.message.deleted":
                this.options.onMessageDeleted?.(frame.payload);
                return;
            case "chat.typing":
                this.options.onTyping?.(frame.payload);
                return;
        }
    }
    /** Sends a message, or keeps it to send on the next attach. */
    send(channelId, content, parentMessageId) {
        if (channelId === "")
            throw new Error("haiven: channelId is required");
        const message = {
            clientMessageId: this.newClientMessageId(),
            channelId,
            content,
            state: "sending",
            ...(parentMessageId === undefined ? {} : { parentMessageId }),
        };
        this.messages.push(message);
        if (this.usable())
            this.write(message);
        else
            this.change(message, "unconfirmed");
        return message;
    }
    /** Sends `chat.typing`. Typing is best effort and is never resent. */
    sendTyping(channelId) {
        if (this.usable())
            this.session.send("chat.typing", { channelId });
    }
    /** Stops tracking a message, normally one in a final state. */
    forget(message) {
        const index = this.messages.indexOf(message);
        if (index >= 0)
            this.messages.splice(index, 1);
        for (const [requestId, tracked] of this.byRequestId) {
            if (tracked === message)
                this.byRequestId.delete(requestId);
        }
    }
    usable() {
        return this.session !== undefined && this.session.state !== "closed";
    }
    write(message) {
        const payload = {
            channelId: message.channelId,
            clientMessageId: message.clientMessageId,
            content: message.content,
            ...(message.parentMessageId === undefined ? {} : { parentMessageId: message.parentMessageId }),
        };
        const frame = this.session.send("chat.send", payload);
        this.byRequestId.set(frame.requestId, message);
        this.change(message, "sending");
    }
    reply(requestId, success, error, payload) {
        if (requestId === undefined)
            return;
        const message = this.byRequestId.get(requestId);
        if (message === undefined)
            return;
        this.byRequestId.delete(requestId);
        if (!success) {
            if (error !== undefined)
                message.error = error;
            this.change(message, "refused");
            return;
        }
        const submission = payload;
        if (submission?.message?.id !== undefined)
            message.messageId = submission.message.id;
        if (submission?.moderationState !== undefined)
            message.moderationState = submission.moderationState;
        this.change(message, outgoingStateFor(submission?.moderationState));
    }
    closed() {
        // Unanswered sends may or may not have landed; the next attach resends them
        // under the same client message id, which the server deduplicates.
        const unanswered = [...this.byRequestId.values()];
        this.byRequestId.clear();
        this.session = undefined;
        for (const message of unanswered)
            this.change(message, "unconfirmed");
    }
    change(message, state) {
        message.state = state;
        this.options.onOutgoingChanged?.(message);
    }
}
