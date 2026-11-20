import type { ChatMessageV0, ChatTypingV0 } from "./contracts.js";
import type { Session, SessionEvent } from "./ws/session.js";
/** Where a message this player sent stands. */
export type OutgoingChatState =
/** Written, or queued until the session authenticates; no reply yet. */
"sending"
/** The socket closed before the reply. The next `attach` resends it. */
 | "unconfirmed"
/** Accepted and visible to the channel (`allowed` or `warned`). */
 | "accepted"
/** Accepted but held for moderation (`pending` or `review_pending`). */
 | "held"
/** Accepted but not shown (`hidden` or `blocked`). */
 | "removed"
/** Refused with an error code; resending the same message cannot succeed. */
 | "refused";
/** One message this player sent, tracked by its client message id. */
export type OutgoingChatMessage = {
    /** The deduplication key: a resend under it is the same message to the server. */
    readonly clientMessageId: string;
    readonly channelId: string;
    readonly content: string;
    readonly parentMessageId?: string;
    state: OutgoingChatState;
    messageId?: string;
    moderationState?: string;
    error?: string;
};
export type HaivenChatOptions = {
    /** Injected so tests are deterministic; defaults to `crypto.randomUUID`. */
    clientMessageId?: () => string;
    onOutgoingChanged?: (message: OutgoingChatMessage) => void;
    onMessage?: (message: ChatMessageV0) => void;
    onMessageUpdated?: (message: ChatMessageV0) => void;
    onMessageDeleted?: (message: ChatMessageV0) => void;
    onTyping?: (typing: ChatTypingV0) => void;
};
/** A moderation state minted after this build reads as held, never as visible. */
export declare function outgoingStateFor(moderationState: string | undefined): OutgoingChatState;
export declare class HaivenChat {
    private readonly newClientMessageId;
    private readonly options;
    private readonly messages;
    private readonly byRequestId;
    private session;
    private activeChannel;
    private activeChannelWritten;
    constructor(options?: HaivenChatOptions);
    /** Messages this player sent, oldest first, until `forget`. */
    get outbox(): readonly OutgoingChatMessage[];
    /** The channel marked open with `setActiveChannel`, if any. */
    get activeChannelId(): string | undefined;
    /**
     * Uses this session from now on, and resends every unconfirmed message
     * through it. It also writes a `setActiveChannel` mark that no session has
     * written yet.
     */
    attach(session: Session): void;
    /** Forward each event of the attached session here (the session's `onEvent`). */
    handle(event: SessionEvent): void;
    /** Sends a message, or keeps it to send on the next attach. */
    send(channelId: string, content: string, parentMessageId?: string): OutgoingChatMessage;
    /** Sends `chat.typing` with `isTyping` true. Typing is best effort and is never resent. */
    sendTyping(channelId: string): void;
    /**
     * Marks `channelId` as the channel this player has open, with
     * `chat.channel.active`: now, or on the next `attach` when no session is
     * attached. The server delivers `chat.typing` only to the users who have a
     * channel open. It keeps the mark per socket, and on a session channel it
     * refuses the mark from a socket the participation has not resumed on, so
     * after a reconnect mark the channel again once `session.resume` succeeds,
     * never before. One channel is open at a time; marking another replaces it.
     */
    setActiveChannel(channelId: string): void;
    /**
     * Forgets the mark for `channelId`, so a later `attach` does not write it.
     * It does nothing when another channel is open. The server drops a socket's
     * mark when that socket closes.
     */
    clearActiveChannel(channelId: string): void;
    /** Stops tracking a message, normally one in a final state. */
    forget(message: OutgoingChatMessage): void;
    private usable;
    private writeActiveChannel;
    private write;
    private reply;
    private closed;
    private change;
}
