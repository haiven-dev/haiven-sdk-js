/**
 * A deterministic provider for the published auth-handoff corpus.
 *
 * It implements the fixture contract, not SDK product behaviour. The generated
 * REST methods are the client under test; this provider only gives every target
 * runner the same clock, bindings, atomic-consume semantics, and responses.
 */
export class HandoffFixture {
    definition;
    requests = { credential: 0, create: 0, exchange: 0 };
    lastResponse = null;
    startMs;
    nowMs;
    nextCode = 1;
    codes = new Map();
    constructor(definition) {
        this.definition = definition;
        this.startMs = Date.parse(definition.now);
        this.nowMs = this.startMs;
    }
    advance(seconds) {
        this.nowMs += seconds * 1_000;
    }
    credential(name) {
        const credential = this.definition.credentials[name];
        if (!credential)
            throw new Error(`unknown fixture credential ${name}`);
        return credential;
    }
    integration(name) {
        const integration = this.definition.integrations[name];
        if (!integration)
            throw new Error(`unknown fixture integration ${name}`);
        return integration;
    }
    redirect(name) {
        const redirect = this.definition.redirects[name];
        if (!redirect)
            throw new Error(`unknown fixture redirect ${name}`);
        return redirect;
    }
    state(name) {
        const state = this.definition.states[name];
        if (!state)
            throw new Error(`unknown fixture state ${name}`);
        return state;
    }
    verifier(name) {
        const verifier = this.definition.verifiers[name];
        if (!verifier)
            throw new Error(`unknown fixture verifier ${name}`);
        return verifier;
    }
    fetch = async (rawUrl, init) => {
        const path = new URL(rawUrl).pathname;
        if (path === "/v0/auth/handoff/credential" && init.method === "GET") {
            this.requests.credential += 1;
            return this.readCredential(init.headers);
        }
        if (path === "/v0/auth/handoff" && init.method === "POST") {
            this.requests.create += 1;
            return this.create(init.headers, init.body);
        }
        if (path === "/v0/auth/handoff/exchange" && init.method === "POST") {
            this.requests.exchange += 1;
            return this.exchange(init.headers, init.body);
        }
        return this.respond(404, { status: 404, code: "not_found", message: "fixture route not found" });
    };
    readCredential(headers) {
        const credential = this.authorizedCredential(headers);
        const expiresIn = credential ? this.remainingSeconds(credential) : 0;
        if (!credential || expiresIn <= 0)
            return this.expired();
        return this.respond(200, {
            accessToken: credential.access_token,
            tokenType: credential.token_type,
            expiresAt: new Date(this.nowMs + expiresIn * 1_000).toISOString(),
        }, true);
    }
    create(headers, rawBody) {
        const credential = this.authorizedCredential(headers);
        const expiresIn = credential ? this.remainingSeconds(credential) : 0;
        if (!credential || expiresIn <= 0)
            return this.expired();
        const body = this.jsonBody(rawBody);
        const integration = this.findIntegration(body.integrationId);
        if (!integration ||
            typeof body.redirectUri !== "string" ||
            !integration.allowed_redirects.includes(body.redirectUri) ||
            typeof body.state !== "string" ||
            body.state.length < 16 ||
            typeof body.codeChallenge !== "string") {
            return this.error(400, "invalid_handoff_request");
        }
        if (body.codeChallengeMethod !== "S256")
            return this.error(400, "unsupported_pkce");
        const code = `fixture-handoff-code-${this.nextCode++}`;
        const tokenExpiresAt = this.startMs + credential.expires_in * 1_000;
        const codeExpiresAt = Math.min(this.nowMs + this.definition.code_ttl_seconds * 1_000, tokenExpiresAt);
        this.codes.set(code, {
            integrationId: integration.id,
            redirectUri: body.redirectUri,
            challenge: body.codeChallenge,
            credential,
            codeExpiresAt,
            tokenExpiresAt,
        });
        return this.respond(200, {
            code,
            state: body.state,
            redirectUri: body.redirectUri,
            expiresAt: new Date(codeExpiresAt).toISOString(),
        }, true);
    }
    exchange(headers, rawBody) {
        if (headers["Content-Type"] !== "application/x-www-form-urlencoded") {
            return this.error(400, "invalid_handoff_request");
        }
        const form = new URLSearchParams(rawBody ?? "");
        const code = form.get("code") ?? "";
        const verifier = form.get("code_verifier") ?? "";
        const integrationId = form.get("integration_id") ?? "";
        const redirectUri = form.get("redirect_uri") ?? "";
        const integration = this.findIntegration(integrationId);
        if (!integration || !integration.allowed_redirects.includes(redirectUri)) {
            return this.error(400, "invalid_handoff_code");
        }
        const record = this.codes.get(code);
        this.codes.delete(code);
        if (!record)
            return this.error(400, "invalid_handoff_code");
        const challenge = Object.values(this.definition.verifiers).find((candidate) => candidate.value === verifier)?.challenge;
        if (record.integrationId !== integrationId ||
            record.redirectUri !== redirectUri ||
            record.challenge !== challenge ||
            record.codeExpiresAt <= this.nowMs) {
            return this.error(400, "invalid_handoff_code");
        }
        const expiresIn = Math.floor((record.tokenExpiresAt - this.nowMs) / 1_000);
        if (expiresIn <= 0)
            return this.expired();
        return this.respond(200, {
            access_token: record.credential.access_token,
            token_type: record.credential.token_type,
            expires_in: expiresIn,
        }, true);
    }
    authorizedCredential(headers) {
        const token = headers.Authorization?.replace(/^Bearer /, "");
        return Object.values(this.definition.credentials).find((item) => item.access_token === token) ?? null;
    }
    remainingSeconds(credential) {
        return Math.floor((this.startMs + credential.expires_in * 1_000 - this.nowMs) / 1_000);
    }
    findIntegration(id) {
        return Object.values(this.definition.integrations).find((item) => item.id === id) ?? null;
    }
    jsonBody(raw) {
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    expired() {
        return this.error(401, "handoff_session_expired");
    }
    error(status, code) {
        return this.respond(status, { status, code, message: code });
    }
    respond(status, body, noStore = false) {
        const headers = { "Content-Type": "application/json" };
        if (noStore) {
            headers["Cache-Control"] = "no-store";
            headers.Pragma = "no-cache";
        }
        this.lastResponse = { status, headers, body };
        return {
            status,
            headers: {
                get: (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null,
            },
            text: async () => JSON.stringify(body),
        };
    }
}
