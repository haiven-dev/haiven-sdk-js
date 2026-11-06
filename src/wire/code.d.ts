/** A code the client knew about when it was compiled. */
export type KnownCode = string;
/**
 * What a client gets back after parsing an error frame.
 *
 * `recognised` is the interesting part: a value can be *present and
 * forwardable* while still being unrecognised, which is the state a sealed enum
 * cannot represent.
 */
export type ParsedCode = {
    readonly value: string;
    readonly recognised: boolean;
};
/**
 * The default generator result: values outside the compiled-in set are not
 * representable, so parsing must either throw or discard.
 *
 * Both variants are modelled because a binding picks one and neither preserves
 * the value.
 *
 * Corrected by F7, which ran the generators instead of predicting them:
 * `typescript-fetch` emits the `const` object plus union type as described, but
 * its `FromJSON` is a bare `return json as Code` — it neither drops nor throws,
 * so in TypeScript the sealed enum is a compile-time problem only. The runtime
 * failures modelled here are real in the other two targets: openapi-generator's
 * C# throws `JsonException` and loses the whole response, and its C++ resolves
 * an unknown value to the first enumerator. `parseOrThrow` also stands for the
 * stricter TS validators (zod/io-ts emitted from the same enum), which do throw.
 */
export declare class SealedCodec {
    private readonly vocabulary;
    constructor(vocabulary: Iterable<KnownCode>);
    /** Discarding variant — the unknown value is silently replaced. */
    parseOrDrop(raw: string): string | undefined;
    /** Throwing variant — the frame carrying the unknown value is unusable. */
    parseOrThrow(raw: string): string;
}
/**
 * The shape that preserves the backend's stated intent.
 *
 * The compiled-in set is still used — for exhaustive handling of the codes the
 * client has logic for — but it gates *recognition*, not *representation*. An
 * unknown code round-trips unchanged, so a client can log it, surface it, and
 * forward it to its own telemetry without the server having to wait for every
 * SDK in the field to be rebuilt.
 */
export declare class OpenCodec {
    private readonly vocabulary;
    constructor(vocabulary: Iterable<KnownCode>);
    parse(raw: string): ParsedCode;
    /** Codes are compared by wire value; identity never depends on recognition. */
    is(parsed: ParsedCode, code: KnownCode): boolean;
}
