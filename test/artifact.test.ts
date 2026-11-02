// Question 5: is there anything a generator can consume?
//
// The claim under test is "the only generated form of the REST surface is
// 373 KB of Go, which no code generator can consume". The first half is true.
// The second turns out not to be, and the difference matters for how the
// OpenAPI item should be scoped.

import { strict as assert } from "node:assert"
import { existsSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

import {
	extractFromFile,
	extractTemplate,
	fillPlaceholders,
	summarize,
} from "../scripts/extract-swagger.mjs"

// Kept as `.go.txt` so Go tooling does not try to build a fixture that is
// deliberately not part of any module.
const FIXTURE = new URL("../fixtures/docs-excerpt.go.txt", import.meta.url).pathname

// The sibling checkout in the Haiven development workspace. Absent in this
// repository's CI, which is why the fixture exists.
const BACKEND_DOCS = new URL(
	"../../../backend/cmd/server/docs/docs.go",
	import.meta.url,
).pathname

describe("recovering a description from swag-generated Go", () => {
	it("rejoins the raw-string halves swag splits around a backtick", () => {
		const doc = extractFromFile(FIXTURE)
		const description = doc.paths["/ws"].get.description

		assert.ok(
			description.includes("`wss://domain.com/ws`"),
			"the markdown backticks survive the concatenation",
		)
	})

	it("leaves nothing unsubstituted", () => {
		const source = readFileSync(FIXTURE, "utf8")
		const filled = fillPlaceholders(extractTemplate(source), { host: "api.example" })
		assert.doesNotMatch(filled, /\{\{/)
		assert.ok(JSON.parse(filled))
	})

	it("yields a valid document — the artifact is present, just unpublished", () => {
		const doc = extractFromFile(FIXTURE)

		// Swagger 2.0, not OpenAPI 3. swag v1 cannot emit OpenAPI 3 at all, so
		// "emit OpenAPI 3 from the swag annotations" is a conversion step, not a
		// flag.
		assert.equal(doc.swagger, "2.0")
		assert.ok(doc.paths && doc.definitions)
	})

	it("fails loudly on input that is not swag output", () => {
		assert.throws(() => extractTemplate("package main\n"), /docTemplate/)
	})
})

// The fixture is a frozen excerpt of swag's *unpatched* output, and it stays
// that way on purpose: this is what the generator still emits for a named string
// type, and it is what backend/cmd/swagpatch exists to correct. The corrected
// artifact is asserted against the real checkout further down, and in the
// backend's own suite.
//
// Note the definition name differs between the two halves of this file, and that
// is now part of what is under test: swag keys it `Code`, after the Go type,
// while the published document calls it `ErrorCode`. `Code` is far too general
// to hand four SDKs as a generated type — the name a consumer writes at every
// call site — and `errorcode.ErrorCode` stutters in Go, so the two names cannot
// be reconciled anywhere except the patch step.
describe("what swag emits for a named string type, before correction", () => {
	it("publishes Code as a sealed enum", () => {
		const doc = extractFromFile(FIXTURE)
		const code = doc.definitions.Code

		assert.equal(code.type, "string")
		assert.ok(Array.isArray(code.enum), "a closed set of permitted values")

		// Nothing in swag's own output records that the backend intends this to
		// stay open. There is no standard keyword for it, which is precisely why
		// the intent does not survive to a generator unaided.
		assert.equal(code.additionalProperties, undefined)
		assert.ok(!("x-enum-open" in code) && !("x-extensible-enum" in code))
	})

	it("carries x-enum-varnames, which most generators use for member names", () => {
		const doc = extractFromFile(FIXTURE)
		const code = doc.definitions.Code

		assert.deepEqual(code["x-enum-varnames"].length, code.enum.length)
	})
})

// Measurements against the real backend. Skipped when the sibling checkout is
// absent so this repository stays clonable on its own; the numbers recorded in
// docs/findings.md come from here.
const hasBackend = existsSync(BACKEND_DOCS)

describe("the real backend surface", { skip: hasBackend ? false : "no ../backend checkout" }, () => {
	it("is recoverable in full", () => {
		const doc = extractFromFile(BACKEND_DOCS)
		const s = summarize(doc)

		assert.equal(doc.swagger, "2.0")
		assert.ok(s.paths > 100, `expected a wide surface, got ${s.paths} paths`)
		assert.ok(s.operations > s.paths)
		assert.ok(s.definitions > 100)
	})

	it("publishes the error-code vocabulary open, so no generator seals it", () => {
		const doc = extractFromFile(BACKEND_DOCS)
		const code = doc.definitions.ErrorCode

		assert.equal(code.type, "string")
		assert.equal(code.enum, undefined, "an enum here would make a validator reject a new code")
		assert.equal(code["x-enum-varnames"], undefined, "the sidecar of enum goes with it")

		const published = code["x-extensible-enum"]
		assert.ok(Array.isArray(published), "the registered values are still advertised")

		// Failure-safe in both directions: a generator that knows the extension
		// emits an open type over these values; one that does not sees a bare
		// string, which is open by construction. Neither emits a sealed type.
		const { "x-extensible-enum": _, description: __, ...rest } = code
		assert.deepEqual(rest, { type: "string" })
	})

	it("partitions that vocabulary by transport", () => {
		const doc = extractFromFile(BACKEND_DOCS)
		const published = doc.definitions.ErrorCode["x-extensible-enum"]

		// The REST document used to carry the union across both transports, so a
		// REST client generated from it got members REST never returns.
		// Not rate_limited: REST and the socket had two spellings for one concept,
		// and the survivor is registered on both, so it no longer demonstrates a
		// partition. A code that cannot exist on REST by construction does.
		assert.ok(!published.includes("unknown_message_type"), "a WS-only code, not in REST")
		assert.ok(!published.includes("invalid_payload"), "another")

		assert.ok(published.includes("bad_request"), "REST codes are still there")

		// A floor only. This used to carry a ceiling of 93 — the registry size at
		// the time — and that made an ordinary vocabulary addition fail a test
		// about partitioning. The ceiling was also redundant: publishing the union
		// is exactly what the two exclusions above catch, and they catch it by
		// naming the codes rather than by counting.
		assert.ok(
			published.length > 80,
			`expected the REST partition, got ${published.length}`,
		)
	})

	it("still describes the socket as a single 101 response", () => {
		const doc = extractFromFile(BACKEND_DOCS)
		const ws = doc.paths["/ws"]?.get

		assert.ok(ws, "/ws is in the document")
		assert.ok(ws.responses["101"], "as an upgrade")
		// No frame schemas, no envelope, no error vocabulary for the socket.
		assert.deepEqual(Object.keys(ws.responses), ["101"])
	})

	it("never answers success with a bare string", () => {
		const s = summarize(extractFromFile(BACKEND_DOCS))

		// This was 45 when the harness was written, and the assertion was `> 40`.
		// It went to 4 when the success *vocabulary* was deleted (F14) and to 0
		// when the four data-bearing bodies got envelopes (F15) — a referral code,
		// an API key and its prefix — except the friend-decline, which echoed the
		// relationship id from its own path and so needed deleting rather than
		// wrapping.
		//
		// Zero is the whole assertion now. A bare string body can never gain a
		// field, and every binding types it as `string`, so two unrelated
		// endpoints are indistinguishable at the call site.
		assert.deepEqual(s.successBodies.bareString, [])
	})
})
