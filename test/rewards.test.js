// Reward claims claim once however often they are retried, and report their
// confirmation. The same rules as the .NET RewardClaims and the C++ FRewardClaims.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { RestClient, RestError } from "../src/rest/client.js";
import { findPlayerStatus, founderStatus, getGameAccess } from "../src/player-access.js";
import { RewardClaims, RewardClaimSessionChangedError, confirmReward, formatUuidV7, grantReward, memoryRewardClaimStore, newUuidV7, rewardConfirmation, } from "../src/rewards.js";
import { ERROR_CODE } from "../src/vocabulary.js";
import { OpenCodec } from "../src/wire/code.js";
function respond(status, body) {
    const contentType = body === undefined ? null : "application/json; charset=utf-8";
    return {
        status,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
        text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
    };
}
function recorded(claimId, confirmation, rewardRef = "hat") {
    return { claimId, claimedAt: "2026-10-10T00:00:00Z", confirmation, integrationId: "game-1", rewardRef };
}
function refusal(status, code) {
    return respond(status, { code, message: "no", status });
}
function deferredReply() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function server(replies) {
    const sent = [];
    const queue = [...replies];
    const client = new RestClient({
        baseUrl: "https://api.example/v0",
        codes: new OpenCodec(Object.values(ERROR_CODE)),
        fetch: async (url, init) => {
            sent.push({ url, method: init.method, headers: init.headers, body: init.body });
            const next = queue.shift();
            assert.ok(next, `no response queued for ${init.method} ${url}`);
            if (next instanceof Error)
                throw next;
            return await next;
        },
        tokens: { read: () => "access-1", write: () => { } },
    });
    return { api: client.endpoints, sent, claimIds: () => sent.map((request) => JSON.parse(request.body ?? "{}").claimId) };
}
function claims(replies) {
    const peer = server(replies);
    let ids = 0;
    const claimed = [];
    const rewards = new RewardClaims(peer.api, {
        integrationId: "game-1",
        claimId: () => `claim-${++ids}`,
        onClaimed: (outcome) => claimed.push(outcome.claim?.claimId ?? ""),
    });
    return { rewards, claimed, ...peer };
}
describe("reward claims", () => {
    it("keeps Phase 1 game access, empty success, open errors, and statuses distinct", async () => {
        const { api, sent } = server([
            respond(200, { access: true, basis: "free", permanent: true, refundHold: false }),
            respond(204),
            refusal(503, "auth_backend_changed"),
        ]);
        assert.equal((await getGameAccess(api, 42))?.access, true);
        assert.equal(sent[0]?.url, "https://api.example/v0/games/42/access");
        assert.equal(await getGameAccess(api, 42), null, "a successful no-body reply stays null");
        const error = await getGameAccess(api, 42).catch((failure) => failure);
        assert.ok(error instanceof RestError);
        assert.equal(error.code?.value, "auth_backend_changed", "an unlisted error code stays open");
        const eligibility = {
            eligible: false,
            statuses: [
                { code: "founder", tier: "gold" },
                { code: "recognised_later", tier: "one" },
            ],
        };
        assert.equal(founderStatus(eligibility)?.tier, "gold", "founder status is independent of eligibility");
        assert.equal(findPlayerStatus(eligibility, "recognised_later")?.code, "recognised_later");
    });
    it("reuses the claim id across retryable failures, and releases it on a final answer", async () => {
        const { rewards, sent, claimIds, claimed } = claims([
            new TypeError("fetch failed"),
            respond(503),
            respond(201, "not json"),
            respond(200, recorded("claim-1", "client_reported")),
            respond(201, recorded("claim-2", "client_reported")),
        ]);
        const lost = await rewards.claim("hat");
        assert.equal(lost.result, "failed");
        assert.equal(lost.retryable, true);
        assert.equal(sent[0].method, "POST");
        assert.equal(sent[0].url, "https://api.example/v0/users/me/rewards/claims");
        assert.deepEqual(JSON.parse(sent[0].body ?? ""), { claimId: "claim-1", integrationId: "game-1", rewardRef: "hat" });
        assert.equal(rewards.pending("hat"), "claim-1");
        assert.equal((await rewards.claim("hat")).retryable, true, "a server error is retryable");
        const garbled = await rewards.claim("hat");
        assert.equal(garbled.result, "failed", "a 2xx that is not a claim may have been recorded");
        assert.equal(garbled.retryable, true);
        const done = await rewards.claim("hat");
        assert.equal(done.result, "claimed");
        assert.equal(done.claim?.claimId, "claim-1");
        assert.equal(done.confirmation, "client_reported");
        assert.deepEqual(claimIds(), ["claim-1", "claim-1", "claim-1", "claim-1"], "every retry carried the same claim id");
        assert.equal(rewards.pending("hat"), undefined);
        assert.deepEqual(claimed, ["claim-1"]);
        await rewards.claim("hat");
        assert.equal(claimIds()[4], "claim-2", "the next claim of the reward is a new claim");
    });
    it("maps each documented refusal to a final result with its code", async () => {
        const cases = [
            [403, "reward_not_eligible", "not_eligible"],
            [409, "reward_already_claimed", "already_claimed"],
            [409, "reward_claim_conflict", "claim_conflict"],
            [409, "refund_in_progress", "refund_in_progress"],
        ];
        const { rewards } = claims(cases.map(([status, code]) => refusal(status, code)));
        for (const [status, code, result] of cases) {
            const outcome = await rewards.claim("boots");
            assert.equal(outcome.result, result);
            assert.equal(outcome.code, code);
            assert.equal(outcome.status, status);
            assert.equal(outcome.retryable, false);
            assert.equal(rewards.pending("boots"), undefined, `${code} releases the claim id`);
        }
    });
    it("keeps an unlisted code and does not retry a client error", async () => {
        const { rewards } = claims([refusal(409, "resource_already_exists"), refusal(400, "invalid_request")]);
        const unknown = await rewards.claim("boots");
        assert.equal(unknown.result, "failed");
        assert.equal(unknown.code, "resource_already_exists");
        assert.equal(unknown.retryable, false);
        assert.equal((await rewards.claim("boots")).retryable, false);
    });
    it("refreshes a claim's confirmation under its own claim id", async () => {
        const { rewards, claimIds, claimed } = claims([
            respond(201, recorded("claim-1", "client_reported")),
            respond(200, recorded("claim-1", "server_confirmed")),
        ]);
        const first = await rewards.claim("hat");
        assert.equal(first.confirmation, "client_reported");
        assert.ok(first.claim);
        const now = await rewards.refresh(first.claim);
        assert.equal(now.confirmation, "server_confirmed");
        assert.deepEqual(claimIds(), ["claim-1", "claim-1"], "the refresh repeats the recorded claim, never a new one");
        assert.deepEqual(claimed, ["claim-1", "claim-1"]);
    });
    it("counts reward ref limits in Unicode code points", async () => {
        const { rewards, sent } = claims([new TypeError("offline")]);
        await assert.rejects(() => rewards.claim(""), TypeError);
        const supplementary = "\u{1f600}";
        await rewards.claim(supplementary.repeat(128));
        await assert.rejects(() => rewards.claim(supplementary.repeat(129)), TypeError);
        assert.equal(sent.length, 1);
        assert.equal(JSON.parse(sent[0].body ?? "{}").rewardRef, supplementary.repeat(128));
    });
    it("forgets pending claim ids on clear", async () => {
        const { rewards } = claims([new TypeError("offline")]);
        await rewards.claim("cape");
        rewards.clear();
        assert.equal(rewards.pending("cape"), undefined);
    });
    it("rejects stale claim and refresh replies after clear without disturbing the next player", async () => {
        const staleClaimReply = deferredReply();
        const playerBReply = deferredReply();
        const staleRefreshReply = deferredReply();
        const peer = server([staleClaimReply.promise, playerBReply.promise, staleRefreshReply.promise]);
        let ids = 0;
        const claimed = [];
        const rewards = new RewardClaims(peer.api, {
            integrationId: "game-1",
            claimId: () => `claim-${++ids}`,
            onClaimed: (outcome) => claimed.push(outcome.claim?.claimId ?? ""),
        });
        const playerAClaim = rewards.claim("scarf");
        assert.equal(rewards.pending("scarf"), "claim-1");
        rewards.clear();
        const playerBClaim = rewards.claim("scarf");
        assert.equal(rewards.pending("scarf"), "claim-2");
        staleClaimReply.resolve(respond(201, recorded("claim-1", "client_reported", "scarf")));
        await assert.rejects(playerAClaim, RewardClaimSessionChangedError);
        assert.equal(rewards.pending("scarf"), "claim-2", "the stale completion preserves the next player's pending id");
        assert.deepEqual(claimed, [], "the stale completion is not delivered to the next player's callback");
        playerBReply.resolve(respond(201, recorded("claim-2", "client_reported", "scarf")));
        const playerBOutcome = await playerBClaim;
        assert.ok(playerBOutcome.claim);
        assert.deepEqual(claimed, ["claim-2"]);
        const playerBRefresh = rewards.refresh(playerBOutcome.claim);
        rewards.clear();
        staleRefreshReply.resolve(respond(200, recorded("claim-2", "server_confirmed", "scarf")));
        await assert.rejects(playerBRefresh, RewardClaimSessionChangedError);
        assert.deepEqual(claimed, ["claim-2"], "a stale refresh is not delivered after sign-out");
    });
    it("rejects a claim when onClaimed synchronously clears the session", async () => {
        const playerBReply = deferredReply();
        const peer = server([respond(201, recorded("claim-1", "client_reported", "scarf")), playerBReply.promise]);
        let ids = 0;
        let playerBClaim;
        let rewards;
        rewards = new RewardClaims(peer.api, {
            integrationId: "game-1",
            claimId: () => `claim-${++ids}`,
            onClaimed: (outcome) => {
                if (outcome.claim?.claimId !== "claim-1")
                    return;
                rewards.clear();
                playerBClaim = rewards.claim("scarf");
            },
        });
        await assert.rejects(rewards.claim("scarf"), RewardClaimSessionChangedError);
        assert.equal(rewards.pending("scarf"), "claim-2", "the callback-driven login preserves player B's pending id");
        playerBReply.resolve(respond(201, recorded("claim-2", "client_reported", "scarf")));
        assert.equal((await playerBClaim).claim?.claimId, "claim-2");
    });
    it("rejects a refresh when onClaimed synchronously clears the session", async () => {
        const peer = server([respond(200, recorded("claim-1", "server_confirmed", "scarf"))]);
        let rewards;
        rewards = new RewardClaims(peer.api, {
            integrationId: "game-1",
            onClaimed: () => rewards.clear(),
        });
        await assert.rejects(rewards.refresh(recorded("claim-1", "client_reported", "scarf")), RewardClaimSessionChangedError);
    });
    it("rejects a claim after a queued callback clear without deleting the next player's pending id", async () => {
        const playerBReply = deferredReply();
        const peer = server([respond(201, recorded("claim-1", "client_reported", "scarf")), playerBReply.promise]);
        let ids = 0;
        let playerBClaim;
        let rewards;
        rewards = new RewardClaims(peer.api, {
            integrationId: "game-1",
            claimId: () => `claim-${++ids}`,
            onClaimed: (outcome) => {
                if (outcome.claim?.claimId !== "claim-1")
                    return;
                queueMicrotask(() => {
                    rewards.clear();
                    playerBClaim = rewards.claim("scarf");
                });
            },
        });
        await assert.rejects(rewards.claim("scarf"), RewardClaimSessionChangedError);
        assert.equal(rewards.pending("scarf"), "claim-2", "the stale claim must not clean up player B's pending id");
        playerBReply.resolve(respond(201, recorded("claim-2", "client_reported", "scarf")));
        assert.equal((await playerBClaim).claim?.claimId, "claim-2");
    });
    it("never reads an unknown confirmation as server-confirmed", () => {
        assert.equal(rewardConfirmation("notarised"), "unrecognized");
        assert.equal(rewardConfirmation(undefined), "unrecognized");
    });
    it("saves a claim before link and submits that id only after the handoff", async () => {
        const store = memoryRewardClaimStore();
        const peer = server([
            new TypeError("offline"),
            refusal(403, "reward_not_eligible"),
            respond(201, recorded("saved-2", "client_reported", "cape")),
        ]);
        let ids = 0;
        const claimed = [];
        const settled = [];
        const rewards = new RewardClaims(peer.api, {
            integrationId: "game-1",
            claimId: () => `saved-${++ids}`,
            storage: store,
            onClaimed: (outcome) => claimed.push(outcome.claim?.claimId ?? ""),
            onSettled: (outcome) => settled.push(outcome.result),
        });
        const saved = rewards.save("hat");
        assert.equal(saved.claimId, "saved-1");
        assert.equal(peer.sent.length, 0, "saving does not post");
        assert.deepEqual(claimed, [], "saving is not claimed");
        assert.equal(rewards.save("hat").claimId, "saved-1");
        assert.equal(ids, 1, "a second save does not remint");
        assert.equal(rewards.pending("hat"), undefined);
        assert.equal(store.document?.includes('"claimId":"saved-1"'), true);
        const restarted = new RewardClaims(peer.api, {
            integrationId: "game-1",
            claimId: () => `other-${++ids}`,
            storage: store,
        });
        assert.equal(restarted.savedClaims()[0]?.claimId, "saved-1");
        assert.equal(ids, 1, "reload does not remint");
        rewards.clear();
        assert.equal(rewards.savedClaims()[0]?.claimId, "saved-1");
        assert.equal(rewards.pending("hat"), undefined);
        const lost = (await rewards.submitSaved())[0];
        assert.equal(lost?.result, "failed");
        assert.equal(lost?.retryable, true);
        assert.equal(rewards.savedClaims()[0]?.claimId, "saved-1");
        assert.deepEqual(claimed, []);
        assert.deepEqual(JSON.parse(peer.sent[0]?.body ?? ""), { claimId: "saved-1", integrationId: "game-1", rewardRef: "hat" });
        const refused = (await rewards.submitSaved())[0];
        assert.equal(refused?.result, "not_eligible");
        assert.equal(refused?.code, "reward_not_eligible");
        assert.equal(rewards.savedClaims().length, 0);
        assert.deepEqual(claimed, []);
        assert.deepEqual(settled, ["failed", "not_eligible"]);
        const cape = rewards.save("cape");
        assert.equal(cape.claimId, "saved-2");
        let linked;
        rewards.followHandoff({
            onLinked(listener) {
                linked = listener;
            },
        });
        await linked();
        assert.deepEqual(claimed, ["saved-2"]);
        assert.equal(rewards.savedClaims().length, 0, "a recorded claim is no longer waiting");
        assert.equal(JSON.parse(peer.sent.at(-1)?.body ?? "").claimId, "saved-2");
    });
});
describe("server grant and confirmation", () => {
    it("grants and confirms through the integration routes", async () => {
        const { api, sent } = server([
            respond(201, recorded("g-1", "server_confirmed")),
            respond(200, recorded("claim 1", "server_confirmed")),
            refusal(404, "not_found"),
        ]);
        const granted = await grantReward(api, { userId: "u-1", rewardRef: "hat", claimId: "g-1" });
        assert.equal(sent[0].url, "https://api.example/v0/integrations/rewards/claims");
        assert.deepEqual(JSON.parse(sent[0].body ?? ""), { userId: "u-1", rewardRef: "hat", claimId: "g-1" });
        assert.equal(granted.confirmation, "server_confirmed");
        const confirmed = await confirmReward(api, "claim 1");
        assert.equal(sent[1].url, "https://api.example/v0/integrations/rewards/claims/claim%201/confirm");
        assert.equal(confirmed.result, "claimed");
        const missing = await confirmReward(api, "other");
        assert.equal(missing.result, "not_found");
        assert.equal(missing.retryable, false);
    });
});
describe("claim ids", () => {
    it("are UUIDv7s", () => {
        assert.equal(formatUuidV7(0x0192f3a4b5c6, Uint8Array.from([0xff, 0x12, 0xff, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0])), "0192f3a4-b5c6-7f12-bf34-56789abcdef0");
        assert.match(newUuidV7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
    it("uses an injected native UUIDv7 without global Web Crypto and preserves it on retry", async () => {
        const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
        try {
            const claimId = formatUuidV7(0x0192f3a4b5c6, Uint8Array.from([0xff, 0x12, 0xff, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]));
            const peer = server([new TypeError("offline"), respond(200, recorded(claimId, "client_reported"))]);
            const rewards = new RewardClaims(peer.api, { integrationId: "game-1", claimId: () => claimId });
            assert.equal((await rewards.claim("hat")).retryable, true);
            assert.equal((await rewards.claim("hat")).result, "claimed");
            assert.match(claimId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            assert.deepEqual(peer.claimIds(), [claimId, claimId]);
        }
        finally {
            if (cryptoDescriptor === undefined)
                Reflect.deleteProperty(globalThis, "crypto");
            else
                Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
        }
    });
});
