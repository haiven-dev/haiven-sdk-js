import type { ChatDmV0, WsServerReplyV0 } from "../src/contracts.js";
/** `Value` has to be assignable to `Expected`, or `tsc --noEmit` fails here. */
type Is<Expected, Value extends Expected> = Value;
export type Refused = Is<WsServerReplyV0, {
    type: "chat.send";
    requestId: "rq-1";
    success: false;
    error: "rate_limited";
}>;
export type ReadOnlyDm = Is<Pick<ChatDmV0, "channelId" | "readOnly">, {
    channelId: "c1";
    readOnly: true;
}>;
export {};
