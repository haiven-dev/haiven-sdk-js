// Two ways to bind `errorcode.Code`, side by side.
//
// The backend declares the type as deliberately open:
//
//   > Code is deliberately an open string type rather than a sealed enum. The
//   > backend may only emit registered codes (see Valid), but an SDK built
//   > against an older contract must be able to receive, log and forward a code
//   > it does not yet know rather than crash or discard the value.
//   -- backend/internal/platform/wire/errorcode/errorcode.go
//
// swag emits `Code` as `{"type":"string","enum":[...94 values]}` with an
// `x-enum-varnames` sidecar, which is a *closed* set: a standards-compliant
// generator has no way to know the author meant otherwise, so it emits a sealed
// type. This module holds both results so the difference is testable rather than
// asserted.
//
// Resolved upstream by `backend/cmd/swagpatch`: the published document now
// carries the registered values under `x-extensible-enum` and no `enum`, so a
// generator that knows the extension emits the open form below and one that does
// not sees a bare `string`. `SealedCodec` stays as the counterfactual — it is
// what every binding gets by default if that step is ever dropped.
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
export class SealedCodec {
    vocabulary;
    constructor(vocabulary) {
        this.vocabulary = new Set(vocabulary);
    }
    /** Discarding variant — the unknown value is silently replaced. */
    parseOrDrop(raw) {
        return this.vocabulary.has(raw) ? raw : undefined;
    }
    /** Throwing variant — the frame carrying the unknown value is unusable. */
    parseOrThrow(raw) {
        if (!this.vocabulary.has(raw)) {
            throw new TypeError(`unknown error code: ${raw}`);
        }
        return raw;
    }
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
export class OpenCodec {
    vocabulary;
    constructor(vocabulary) {
        this.vocabulary = new Set(vocabulary);
    }
    parse(raw) {
        return { value: raw, recognised: this.vocabulary.has(raw) };
    }
    /** Codes are compared by wire value; identity never depends on recognition. */
    is(parsed, code) {
        return parsed.value === code;
    }
}
// The emitters that produced the vocabularies beside this module used to live
// here. They are Python now, in `codegen/vocabulary.py`, with their unit tests
// in `codegen/test/test_vocabulary.py`.
//
// They were never SDK code. A consumer of this package cannot call a C++ or a C#
// emitter, and every byte of them shipped anyway. Standardising the generators on
// one language moved them out; what stays here is what a consumer actually binds
// against: the two codecs above.
