/**
 * An SDK-local error code: raised by this SDK, never sent by the server, and
 * finite. It is not part of the contracts' open error vocabularies, so it is a
 * closed union rather than a {@link ParsedCode}.
 */
export type DecodeErrorCode = "integer_precision_exceeded";
export declare const INTEGER_PRECISION_EXCEEDED: DecodeErrorCode;
/** A document this SDK refused to decode. Branch on `code`, not the message. */
export declare class DecodeError extends Error {
    readonly code: DecodeErrorCode;
    constructor(code: DecodeErrorCode, message: string);
}
/**
 * The first integer literal in a JSON text whose magnitude exceeds 2^53 - 1, or
 * undefined. Expects text `JSON.parse` has already accepted.
 */
export declare function findUnsafeInteger(text: string): string | undefined;
/**
 * `JSON.parse`, except that an integer literal beyond 2^53 - 1 throws a
 * {@link DecodeError} with code `integer_precision_exceeded` instead of being
 * rounded. Malformed JSON still throws `SyntaxError`, as before.
 */
export declare function decodeJson(text: string): unknown;
