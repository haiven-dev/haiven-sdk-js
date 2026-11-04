// The REST half of the binding, which the spike had never attempted.
//
// The socket half was measured first because it was the one with no
// machine-readable description. REST had the opposite problem: a 380 KB Go file
// nobody could consume. That artifact is now emitted as `swagger.json`, so this
// is the first time the REST surface can be bound against something a generator
// reads rather than against a reading of the handlers.
//
// Everything here is hand-written on purpose. The point is to find what the
// surface costs a client *before* a generator hides it — a generated client
// would paper over exactly the decisions recorded below.
import { OpenCodec } from "../wire/code.js";
import { RestApi } from "./generated.js";
export * from "./generated.js";
/**
 * A request that did not succeed.
 *
 * `code` is what a caller branches on and it is deliberately a {@link ParsedCode}
 * rather than a string union: a client compiled against an older contract has to
 * be able to receive a code minted after it shipped, carry it, and log it. The
 * server's prose lands in `message`, which is for a human and never for a
 * condition.
 */
export class RestError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message || `HTTP ${status}`);
        this.name = "RestError";
        this.status = status;
        this.code = code;
    }
}
export class RestClient {
    options;
    /** One generated, typed method for every operation in the pinned REST description. */
    endpoints;
    constructor(options) {
        this.options = options;
        this.endpoints = new RestApi(this);
    }
    /**
     * Sends one request and returns its parsed body, or `null` when there is
     * none.
     *
     * `null` rather than `undefined` or a thrown parse error: since the success
     * bodies were reduced to a status, most mutations answer 204, and a binding
     * that assumed a body would now throw on every one of them.
     */
    async request(path, init = {}) {
        const { method = "GET", body, contentType = "application/json", retried = false } = init;
        const token = this.options.tokens.read();
        const headers = {};
        if (body !== undefined)
            headers["Content-Type"] = contentType;
        if (token)
            headers.Authorization = `Bearer ${token}`;
        const response = await this.options.fetch(`${this.options.baseUrl}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body: encodeRequestBody(body, contentType) }),
        });
        // One retry, never a loop. A refresh that keeps failing against a revoked
        // session would otherwise retry forever, and the second failure is the
        // one worth reporting.
        if (response.status === 401 && !retried && this.options.refresh) {
            const refreshed = await this.options.refresh();
            this.options.tokens.write(refreshed);
            if (refreshed) {
                return this.request(path, { method, body, contentType, retried: true });
            }
        }
        const payload = await readJson(response);
        if (response.status >= 400) {
            throw toError(this.options.codes, response.status, payload);
        }
        return payload ?? null;
    }
}
function encodeRequestBody(body, contentType) {
    if (contentType === "application/json")
        return JSON.stringify(body);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new TypeError("form request body must be an object");
    }
    const fields = [];
    for (const [name, value] of Object.entries(body)) {
        if (value === undefined)
            continue;
        if (value === null || typeof value === "object") {
            throw new TypeError(`form request field ${name} must be a scalar`);
        }
        fields.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
    return fields.join("&");
}
/**
 * Parses a body only when the server says there is one.
 *
 * The content-type guard is load-bearing rather than defensive. A 204 carries no
 * `Content-Type` at all, so a reader that called `.json()` unconditionally would
 * throw on every successful mutation — which is also why deleting the string
 * success vocabulary was invisible to the two shipped clients: both guard on
 * this header, and both therefore never noticed the bodies disappear.
 */
async function readJson(response) {
    if (!response.headers.get("content-type")?.includes("application/json")) {
        return null;
    }
    const raw = await response.text();
    if (raw === "")
        return null;
    return JSON.parse(raw);
}
function toError(codes, status, payload) {
    if (payload === null || typeof payload !== "object") {
        return new RestError(status, null, "");
    }
    const body = payload;
    return new RestError(status, typeof body.code === "string" ? codes.parse(body.code) : null, typeof body.message === "string" ? body.message : "");
}
