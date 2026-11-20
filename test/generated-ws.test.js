import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { WsApi, WsEventRouter, WsTypes } from "../src/client.js";
function recorder() {
    const sent = [];
    const api = new WsApi((type, payload) => {
        const frame = { type, requestId: `rq-${sent.length + 1}`, payload };
        sent.push(frame);
        return frame;
    });
    return { api, sent };
}
describe("the generated WebSocket requests", () => {
    it("send their wire type and payload through the session", () => {
        const { api, sent } = recorder();
        const frame = api.chatSend({ channelId: "c1", content: "hi" });
        assert.deepEqual(sent, [{ type: "chat.send", requestId: "rq-1", payload: { channelId: "c1", content: "hi" } }]);
        assert.equal(frame.requestId, "rq-1");
    });
    it("send no payload when the request carries none", () => {
        const { api, sent } = recorder();
        api.transportPing();
        api.notificationsListUnread();
        assert.deepEqual(sent.map((frame) => [frame.type, frame.payload]), [
            ["ping", undefined],
            ["notifications.list.unread", undefined],
        ]);
        assert.equal(WsTypes.Pong, "pong");
    });
});
describe("the generated event router", () => {
    it("hands an OAuth identity-link event to its typed handler", () => {
        const router = new WsEventRouter();
        const linked = [];
        router.onAccountIdentityLinked((payload) => linked.push(payload));
        const handled = router.dispatch({
            type: "account.identity.linked",
            payload: { provider: "google", email: "player@example.test" },
        });
        assert.equal(handled, true);
        assert.deepEqual(linked, [{ provider: "google", email: "player@example.test" }]);
    });
    it("hands the entitlement refresh hint to its typed handler", () => {
        const router = new WsEventRouter();
        const versions = [];
        router.onEntitlementsUpdated((payload) => versions.push(payload.projectionVersion));
        assert.equal(router.dispatch({ type: WsTypes.EntitlementsUpdated, payload: { projectionVersion: 5 } }), true);
        assert.deepEqual(versions, [5]);
    });
    it("hands the Message of the Day to its typed handler", () => {
        const router = new WsEventRouter();
        const bodies = [];
        router.onMotd((payload) => bodies.push(payload.body));
        const motd = { id: "00000000-0000-4000-8000-000000000001", body: "New rewards are live.", startsAt: "2026-10-03T00:00:00Z" };
        assert.equal(router.dispatch({ type: WsTypes.Motd, payload: motd }), true);
        assert.deepEqual(bodies, ["New rewards are live."]);
    });
    it("leaves replies, unknown types, and unsubscribed events on the unhandled path", () => {
        const router = new WsEventRouter();
        const seen = [];
        const off = router.on("account.identity.link.failed", (payload) => seen.push(payload.provider));
        assert.equal(router.dispatch({ type: "chat.send", success: true, payload: {} }), false);
        assert.equal(router.dispatch({ type: "entitlements.minted.later", payload: {} }), false);
        assert.equal(router.dispatch({ type: "presence.updated", payload: {} }), false);
        assert.equal(router.dispatch({ type: "account.identity.link.failed", payload: { provider: "apple", code: "identity_already_linked" } }), true);
        off();
        assert.equal(router.dispatch({ type: "account.identity.link.failed", payload: { provider: "apple", code: "identity_already_linked" } }), false);
        assert.deepEqual(seen, ["apple"]);
    });
});
