import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HaivenClient, HandoffError, MemoryHandoffTransactionStore, browserHandoffHost, nodeHandoffHost, reactNativeHandoffHost, webCryptoHandoffCrypto, } from "../src/client.js";
import { FakeServerSocket } from "../src/ws/fake-server.js";
const NOW = Date.parse("2026-09-17T12:00:00Z");
const REDIRECT = "haiven-example://auth/callback?mode=login";
const ENTRY = "https://app.haiven.gg/connect/game?from=typescript";
function response(status, body) {
    return {
        status,
        headers: {
            get: (name) => name.toLowerCase() === "content-type" && body !== undefined
                ? "application/json"
                : null,
        },
        text: async () => (body === undefined ? "" : JSON.stringify(body)),
    };
}
function tokenStore(initial = "old-access") {
    let token = initial;
    let expiresAt = null;
    return {
        read: () => token,
        write: (next, expiry = null) => {
            token = next;
            expiresAt = expiry;
        },
        credential: () => ({ token, expiresAt }),
    };
}
function memoryStorage() {
    const values = new Map();
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
        removeItem: (key) => {
            values.delete(key);
        },
    };
}
function clientHarness(exchangeBody = {
    access_token: "handoff-access",
    token_type: "Bearer",
    expires_in: 300,
}) {
    const tokens = tokenStore();
    const requests = [];
    const sockets = [];
    const client = new HaivenClient({
        baseUrl: "https://api.haiven.gg/v0",
        socketUrl: "wss://api.haiven.gg/v0/ws",
        tokens,
        vocabulary: ["unauthorized"],
        fetch: async (url, init) => {
            requests.push({ url, ...init });
            return url.endsWith("/auth/handoff/exchange")
                ? response(200, exchangeBody)
                : response(200, { ok: true });
        },
        connect: () => {
            const socket = new FakeServerSocket({
                tokens: [
                    { value: "old-access", userId: "u1", valid: true },
                    { value: "handoff-access", userId: "u1", valid: true },
                ],
            });
            sockets.push(socket);
            return socket;
        },
    });
    return { client, requests, sockets, tokens };
}
function callback(state, code = "one use/code") {
    const url = new URL(REDIRECT);
    url.searchParams.set("code", code);
    url.searchParams.set("state", state);
    return url.toString();
}
const webCrypto = webCryptoHandoffCrypto(globalThis.crypto);
describe("the TypeScript game-login handoff", () => {
    it("uses independent 256-bit values and the RFC 7636 S256 transform", async () => {
        const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        const entropy = [Buffer.from(verifier, "base64url"), new Uint8Array(32).fill(7)];
        const opened = [];
        const { client } = clientHarness();
        const coordinator = client.createHandoff({
            entryUrl: ENTRY,
            integrationId: "example-game",
            redirectUrl: REDIRECT,
            now: () => NOW,
            host: {
                profile: "node",
                transactions: new MemoryHandoffTransactionStore(),
                randomBytes: () => new Uint8Array(entropy.shift() ?? []),
                sha256: webCrypto.sha256,
                launchUrl: (url) => {
                    opened.push(url);
                },
            },
        });
        const start = await coordinator.beginLogin();
        const authorization = new URL(start.authorizationUrl);
        assert.equal(opened[0], start.authorizationUrl);
        assert.equal(authorization.searchParams.get("from"), "typescript");
        assert.equal(authorization.searchParams.get("integration_id"), "example-game");
        assert.equal(authorization.searchParams.get("completion"), "redirect");
        assert.equal(authorization.searchParams.get("redirect_uri"), REDIRECT);
        assert.equal(authorization.searchParams.get("state"), start.state);
        assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
        assert.equal(authorization.searchParams.get("code_challenge"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert.equal(start.state.length, 43);
        assert.notEqual(start.state, verifier);
    });
    it("validates callback target and state before exchange, then consumes state once", async () => {
        const { client, requests, tokens } = clientHarness();
        const coordinator = client.createHandoff({
            entryUrl: ENTRY,
            integrationId: "example-game",
            redirectUrl: REDIRECT,
            now: () => NOW,
            host: nodeHandoffHost(),
        });
        const start = await coordinator.beginLogin();
        await assert.rejects(coordinator.complete(`haiven-example://other/callback?code=attacker&state=${start.state}`), HandoffError);
        await assert.rejects(coordinator.complete(callback("attacker-state")), HandoffError);
        assert.equal(requests.length, 0, "untrusted callbacks never reach the exchange");
        const credential = await coordinator.complete(callback(start.state));
        assert.deepEqual(credential, {
            accessToken: "handoff-access",
            tokenType: "Bearer",
            expiresAt: NOW + 300_000,
        });
        assert.deepEqual(tokens.credential(), {
            token: "handoff-access",
            expiresAt: NOW + 300_000,
        });
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.headers["Content-Type"], "application/x-www-form-urlencoded");
        const form = new URLSearchParams(requests[0]?.body);
        assert.deepEqual([...form.keys()], ["code", "code_verifier", "integration_id", "redirect_uri"]);
        assert.equal(form.get("code"), "one use/code");
        assert.equal(form.get("code_verifier")?.length, 43);
        assert.equal(form.get("integration_id"), "example-game");
        assert.equal(form.get("redirect_uri"), REDIRECT);
        await assert.rejects(coordinator.complete(callback(start.state)), HandoffError);
        assert.equal(requests.length, 1, "a replay is rejected without a second exchange");
    });
    it("expires verifier state and rejects refresh credentials", async () => {
        let now = NOW;
        const expired = clientHarness();
        const expiredCoordinator = expired.client.createHandoff({
            entryUrl: ENTRY,
            integrationId: "example-game",
            redirectUrl: REDIRECT,
            now: () => now,
            transactionLifetimeMs: 1_000,
            host: nodeHandoffHost(),
        });
        const start = await expiredCoordinator.beginLogin();
        now += 1_001;
        await assert.rejects(expiredCoordinator.complete(callback(start.state)), /expired/);
        assert.equal(expired.requests.length, 0);
        const forbidden = clientHarness({
            access_token: "handoff-access",
            token_type: "Bearer",
            expires_in: 300,
            refresh_token: "must-not-cross-the-boundary",
        });
        const forbiddenCoordinator = forbidden.client.createHandoff({
            entryUrl: ENTRY,
            integrationId: "example-game",
            redirectUrl: REDIRECT,
            now: () => NOW,
            host: nodeHandoffHost(),
        });
        const forbiddenStart = await forbiddenCoordinator.beginLogin();
        await assert.rejects(forbiddenCoordinator.complete(callback(forbiddenStart.state)), /refresh/);
        assert.equal(forbidden.tokens.read(), "old-access");
    });
});
const profiles = [
    {
        name: "browser",
        create: (opened) => browserHandoffHost({
            crypto: globalThis.crypto,
            storage: memoryStorage(),
            openUrl: (url) => opened.push(url),
        }),
    },
    {
        name: "node",
        create: (opened) => nodeHandoffHost({
            openUrl: (url) => {
                opened.push(url);
            },
        }),
    },
    {
        name: "react-native",
        create: (opened) => reactNativeHandoffHost({
            storage: memoryStorage(),
            openUrl: async (url) => {
                opened.push(url);
            },
            randomBytes: webCrypto.randomBytes,
            sha256: webCrypto.sha256,
        }),
    },
];
describe("the browser, Node, and React Native host profiles", () => {
    for (const profile of profiles) {
        it(`${profile.name} writes the assembled client's REST and WebSocket token immediately`, async () => {
            const opened = [];
            const { client, requests, sockets, tokens } = clientHarness();
            const session = client.connect();
            const socket = sockets[0];
            assert.ok(socket);
            socket.open();
            const coordinator = client.createHandoff({
                entryUrl: ENTRY,
                integrationId: "example-game",
                redirectUrl: REDIRECT,
                now: () => NOW,
                host: profile.create(opened),
            });
            const start = await coordinator.beginLogin();
            await coordinator.complete(callback(start.state));
            assert.equal(opened[0], start.authorizationUrl);
            assert.deepEqual(tokens.credential(), {
                token: "handoff-access",
                expiresAt: NOW + 300_000,
            });
            await client.rest.request("/me");
            assert.equal(requests.at(-1)?.headers.Authorization, "Bearer handoff-access");
            socket.expireSession();
            session.send("chat.message.send", { content: "after handoff" });
            assert.deepEqual(socket.sent.filter((frame) => frame.type === "auth").map((frame) => frame.payload), ["old-access", "handoff-access"]);
        });
    }
});
