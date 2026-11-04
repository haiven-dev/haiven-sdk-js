const DEFAULT_TRANSACTION_LIFETIME_MS = 15 * 60 * 1_000;
const PKCE_BYTES = 32;
export class HandoffError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "HandoffError";
    }
}
/**
 * Target-independent PKCE handoff state machine.
 *
 * Host differences stay behind HandoffHost: entropy, SHA-256, URL launching,
 * and transient transaction persistence. The generated REST surface owns the
 * form exchange, while the assembled client owns the TokenStore.
 */
export class HandoffCoordinator {
    rest;
    tokens;
    options;
    constructor(rest, tokens, options) {
        this.rest = rest;
        this.tokens = tokens;
        this.options = {
            ...options,
            transactionLifetimeMs: options.transactionLifetimeMs ?? DEFAULT_TRANSACTION_LIFETIME_MS,
            now: options.now ?? Date.now,
        };
        validateOptions(this.options);
    }
    async beginLogin() {
        const verifier = base64Url(await this.options.host.randomBytes(PKCE_BYTES));
        const state = base64Url(await this.options.host.randomBytes(PKCE_BYTES));
        if (verifier.length < 43 || state.length < 43) {
            throw new HandoffError("The handoff host returned insufficient entropy.");
        }
        const challenge = base64Url(await this.options.host.sha256(Uint8Array.from(verifier, (character) => character.charCodeAt(0))));
        const transaction = {
            state,
            codeVerifier: verifier,
            createdAt: this.options.now(),
        };
        await this.options.host.transactions.put(transaction);
        const authorizationUrl = this.buildAuthorizationUrl(state, challenge);
        try {
            await this.options.host.launchUrl?.(authorizationUrl);
        }
        catch (error) {
            await this.options.host.transactions.remove(state);
            throw error;
        }
        return { authorizationUrl, state };
    }
    async complete(callbackUrl) {
        const callback = absoluteUrl(callbackUrl, "The handoff callback URL must be absolute.");
        if (!this.isExpectedCallback(callback)) {
            throw new HandoffError("The handoff callback does not match the configured redirect URL.");
        }
        const state = callback.searchParams.get("state");
        if (!state)
            throw new HandoffError("The handoff callback has no state.");
        const callbackError = callback.searchParams.get("error");
        if (callbackError) {
            await this.options.host.transactions.remove(state);
            throw new HandoffError(`The handoff callback failed: ${callbackError}`);
        }
        const code = callback.searchParams.get("code");
        if (!code) {
            await this.options.host.transactions.remove(state);
            throw new HandoffError("The handoff callback has no code.");
        }
        // `take` is the client-side one-use boundary. State is checked and consumed
        // before an attacker-controlled code can reach the exchange endpoint.
        const transaction = await this.options.host.transactions.take(state);
        if (!transaction) {
            throw new HandoffError("The handoff state is unknown, expired, or already consumed.");
        }
        if (this.options.now() - transaction.createdAt > this.options.transactionLifetimeMs) {
            throw new HandoffError("The handoff transaction has expired.");
        }
        const response = await this.rest.endpoints.postAuthHandoffExchange({
            body: {
                code,
                code_verifier: transaction.codeVerifier,
                integration_id: this.options.integrationId,
                redirect_uri: this.options.redirectUrl,
            },
        });
        const credential = parseCredential(response, this.options.now());
        this.tokens.write(credential.accessToken, credential.expiresAt);
        return credential;
    }
    buildAuthorizationUrl(state, challenge) {
        const url = new URL(this.options.entryUrl);
        url.searchParams.set("integration_id", this.options.integrationId);
        url.searchParams.set("completion", "redirect");
        url.searchParams.set("redirect_uri", this.options.redirectUrl);
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        setOptional(url.searchParams, "instructions_id", this.options.instructionsId);
        setOptional(url.searchParams, "screen_hint", this.options.screenHint);
        return url.toString();
    }
    isExpectedCallback(callback) {
        const expected = new URL(this.options.redirectUrl);
        if (callback.protocol.toLowerCase() !== expected.protocol.toLowerCase() ||
            callback.hostname.toLowerCase() !== expected.hostname.toLowerCase() ||
            callback.port !== expected.port ||
            callback.pathname !== expected.pathname) {
            return false;
        }
        for (const [name, value] of expected.searchParams) {
            if (callback.searchParams.get(name) !== value)
                return false;
        }
        return true;
    }
}
export class MemoryHandoffTransactionStore {
    values = new Map();
    put(transaction) {
        this.values.set(transaction.state, transaction);
    }
    take(state) {
        const transaction = this.values.get(state) ?? null;
        this.values.delete(state);
        return transaction;
    }
    remove(state) {
        this.values.delete(state);
    }
}
/** SessionStorage/AsyncStorage adapter with serialized one-use reads. */
export class KeyValueHandoffTransactionStore {
    storage;
    prefix;
    tail = Promise.resolve();
    constructor(storage, prefix = "haiven.handoff.") {
        this.storage = storage;
        this.prefix = prefix;
    }
    put(transaction) {
        return this.exclusive(async () => {
            await this.storage.setItem(this.key(transaction.state), JSON.stringify(transaction));
        });
    }
    take(state) {
        return this.exclusive(async () => {
            const key = this.key(state);
            const raw = await this.storage.getItem(key);
            await this.storage.removeItem(key);
            if (raw === null)
                return null;
            return parseTransaction(raw, state);
        });
    }
    remove(state) {
        return this.exclusive(async () => {
            await this.storage.removeItem(this.key(state));
        });
    }
    key(state) {
        return `${this.prefix}${state}`;
    }
    exclusive(operation) {
        const result = this.tail.then(operation, operation);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
}
export function webCryptoHandoffCrypto(crypto) {
    return {
        randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
        sha256: async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value))),
    };
}
function parseCredential(value, now) {
    if (value === null || typeof value !== "object") {
        throw new HandoffError("The handoff exchange returned no credential.");
    }
    const response = value;
    if ("refresh_token" in response) {
        throw new HandoffError("The handoff exchange returned a forbidden refresh credential.");
    }
    if (typeof response.access_token !== "string" ||
        response.access_token.length === 0 ||
        typeof response.token_type !== "string" ||
        response.token_type.length === 0 ||
        typeof response.expires_in !== "number" ||
        !Number.isInteger(response.expires_in) ||
        response.expires_in < 0) {
        throw new HandoffError("The handoff exchange returned an invalid credential.");
    }
    return {
        accessToken: response.access_token,
        tokenType: response.token_type,
        expiresAt: now + response.expires_in * 1_000,
    };
}
function parseTransaction(raw, expectedState) {
    try {
        const value = JSON.parse(raw);
        if (value.state !== expectedState ||
            typeof value.codeVerifier !== "string" ||
            typeof value.createdAt !== "number") {
            throw new Error("invalid transaction");
        }
        return {
            state: expectedState,
            codeVerifier: value.codeVerifier,
            createdAt: value.createdAt,
        };
    }
    catch (error) {
        throw new HandoffError("The stored handoff transaction is invalid.", { cause: error });
    }
}
function validateOptions(options) {
    const entry = absoluteUrl(options.entryUrl, "The handoff entry URL must be absolute.");
    requireSecureWebUrl(entry);
    const redirect = absoluteUrl(options.redirectUrl, "The handoff redirect URL must be absolute.");
    if (redirect.hash)
        throw new HandoffError("The handoff redirect URL must not contain a fragment.");
    if (!options.integrationId.trim())
        throw new HandoffError("A handoff integration id is required.");
    if (!(options.transactionLifetimeMs > 0)) {
        throw new HandoffError("The handoff transaction lifetime must be positive.");
    }
}
function absoluteUrl(value, message) {
    try {
        return new URL(value);
    }
    catch (error) {
        throw new HandoffError(message, { cause: error });
    }
}
function requireSecureWebUrl(url) {
    if (url.protocol === "https:")
        return;
    if (url.protocol === "http:" && isLoopback(url.hostname))
        return;
    throw new HandoffError("The handoff entry URL must use HTTPS (HTTP is allowed only for loopback development).");
}
function isLoopback(hostname) {
    const host = hostname.toLowerCase();
    return host === "localhost" || host === "[::1]" || host === "::1" || /^127(?:\.|$)/.test(host);
}
function setOptional(parameters, name, value) {
    if (value)
        parameters.set(name, value);
}
function base64Url(bytes) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1];
        const third = bytes[index + 2];
        encoded += alphabet[first >> 2];
        encoded += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
        if (second !== undefined) {
            encoded += alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
        }
        if (third !== undefined)
            encoded += alphabet[third & 0x3f];
    }
    return encoded;
}
