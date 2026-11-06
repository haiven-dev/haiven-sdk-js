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

import type { ChatMessageSubmissionV0, ChatMessageV0, ChatSendRequestV0, ChatTypingV0 } from "./contracts.ts"
import type { Session, SessionEvent } from "./ws/session.ts"

/** Where a message this player sent stands. */
export type OutgoingChatState =
	/** Written, or queued until the session authenticates; no reply yet. */
	| "sending"
	/** The socket closed before the reply. The next `attach` resends it. */
	| "unconfirmed"
	/** Accepted and visible to the channel (`allowed` or `warned`). */
	| "accepted"
	/** Accepted but held for moderation (`pending` or `review_pending`). */
	| "held"
	/** Accepted but not shown (`hidden` or `blocked`). */
	| "removed"
	/** Refused with an error code; resending the same message cannot succeed. */
	| "refused"

/** One message this player sent, tracked by its client message id. */
export type OutgoingChatMessage = {
	/** The deduplication key: a resend under it is the same message to the server. */
	readonly clientMessageId: string
	readonly channelId: string
	readonly content: string
	readonly parentMessageId?: string
	state: OutgoingChatState
	messageId?: string
	moderationState?: string
	error?: string
}

export type HaivenChatOptions = {
	/** Injected so tests are deterministic; defaults to `crypto.randomUUID`. */
	clientMessageId?: () => string
	onOutgoingChanged?: (message: OutgoingChatMessage) => void
	onMessage?: (message: ChatMessageV0) => void
	onMessageUpdated?: (message: ChatMessageV0) => void
	onMessageDeleted?: (message: ChatMessageV0) => void
	onTyping?: (typing: ChatTypingV0) => void
}

/** A moderation state minted after this build reads as held, never as visible. */
export function outgoingStateFor(moderationState: string | undefined): OutgoingChatState {
	switch (moderationState) {
		case "allowed":
		case "warned":
			return "accepted"
		case "hidden":
		case "blocked":
			return "removed"
		default:
			return "held"
	}
}

export class HaivenChat {
	private readonly newClientMessageId: () => string
	private readonly options: HaivenChatOptions
	private readonly messages: OutgoingChatMessage[] = []
	// The request each in-flight send went out under, on the attached session.
	private readonly byRequestId = new Map<string, OutgoingChatMessage>()
	private session: Session | undefined

	constructor(options: HaivenChatOptions = {}) {
		this.options = options
		this.newClientMessageId = options.clientMessageId ?? (() => crypto.randomUUID())
	}

	/** Messages this player sent, oldest first, until `forget`. */
	get outbox(): readonly OutgoingChatMessage[] {
		return this.messages
	}

	/** Uses this session from now on, and resends every unconfirmed message through it. */
	attach(session: Session): void {
		this.session = session
		this.byRequestId.clear()
		for (const message of this.messages) {
			if (message.state === "unconfirmed") this.write(message)
		}
	}

	/** Forward each event of the attached session here (the session's `onEvent`). */
	handle(event: SessionEvent): void {
		if (event.kind === "state" && event.to === "closed") {
			this.closed()
			return
		}
		if (event.kind !== "frame") return
		const frame = event.frame
		if (frame.success !== undefined) {
			this.reply(frame.requestId, frame.success, frame.error?.value, frame.payload)
			return
		}
		switch (frame.type) {
			case "chat.message":
				this.options.onMessage?.(frame.payload as ChatMessageV0)
				return
			case "chat.message.updated":
				this.options.onMessageUpdated?.(frame.payload as ChatMessageV0)
				return
			case "chat.message.deleted":
				this.options.onMessageDeleted?.(frame.payload as ChatMessageV0)
				return
			case "chat.typing":
				this.options.onTyping?.(frame.payload as ChatTypingV0)
				return
		}
	}

	/** Sends a message, or keeps it to send on the next attach. */
	send(channelId: string, content: string, parentMessageId?: string): OutgoingChatMessage {
		if (channelId === "") throw new Error("haiven: channelId is required")
		const message: OutgoingChatMessage = {
			clientMessageId: this.newClientMessageId(),
			channelId,
			content,
			state: "sending",
			...(parentMessageId === undefined ? {} : { parentMessageId }),
		}
		this.messages.push(message)
		if (this.usable()) this.write(message)
		else this.change(message, "unconfirmed")
		return message
	}

	/** Sends `chat.typing`. Typing is best effort and is never resent. */
	sendTyping(channelId: string): void {
		if (this.usable()) this.session!.send("chat.typing", { channelId })
	}

	/** Stops tracking a message, normally one in a final state. */
	forget(message: OutgoingChatMessage): void {
		const index = this.messages.indexOf(message)
		if (index >= 0) this.messages.splice(index, 1)
		for (const [requestId, tracked] of this.byRequestId) {
			if (tracked === message) this.byRequestId.delete(requestId)
		}
	}

	private usable(): boolean {
		return this.session !== undefined && this.session.state !== "closed"
	}

	private write(message: OutgoingChatMessage): void {
		const payload: ChatSendRequestV0 = {
			channelId: message.channelId,
			clientMessageId: message.clientMessageId,
			content: message.content,
			...(message.parentMessageId === undefined ? {} : { parentMessageId: message.parentMessageId }),
		}
		const frame = this.session!.send("chat.send", payload)
		this.byRequestId.set(frame.requestId, message)
		this.change(message, "sending")
	}

	private reply(requestId: string | undefined, success: boolean, error: string | undefined, payload: unknown): void {
		if (requestId === undefined) return
		const message = this.byRequestId.get(requestId)
		if (message === undefined) return
		this.byRequestId.delete(requestId)
		if (!success) {
			if (error !== undefined) message.error = error
			this.change(message, "refused")
			return
		}
		const submission = payload as ChatMessageSubmissionV0 | undefined
		if (submission?.message?.id !== undefined) message.messageId = submission.message.id
		if (submission?.moderationState !== undefined) message.moderationState = submission.moderationState
		this.change(message, outgoingStateFor(submission?.moderationState))
	}

	private closed(): void {
		// Unanswered sends may or may not have landed; the next attach resends them
		// under the same client message id, which the server deduplicates.
		const unanswered = [...this.byRequestId.values()]
		this.byRequestId.clear()
		this.session = undefined
		for (const message of unanswered) this.change(message, "unconfirmed")
	}

	private change(message: OutgoingChatMessage, state: OutgoingChatState): void {
		message.state = state
		this.options.onOutgoingChanged?.(message)
	}
}
