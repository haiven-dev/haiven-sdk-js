import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { TelemetryReporter, type TelemetryDiagnostic } from "../src/telemetry.ts"

type Call = { path: string; body: unknown }

function reporter(overrides: {
	request?: (path: string, init: { body?: unknown }) => Promise<unknown>
	includeErrorMessages?: boolean
	onDiagnostic?: (diagnostic: TelemetryDiagnostic) => void
} = {}) {
	const calls: Call[] = []
	const request = overrides.request ?? (async (path: string, init: { body?: unknown }) => {
		calls.push({ path, body: init.body })
		return { accepted: true, duplicate: false }
	})
	return {
		calls,
		reporter: new TelemetryReporter({
			rest: { request },
			runtime: {
				integrationId: "example-game",
				sdk: { name: "haiven-js", version: "0.1.0" },
				platform: "web",
				environment: "production",
			},
			sessionId: "0199e5a7-5f52-7d85-997b-2c5150a97523",
			eventId: () => "0199e5a8-d13d-70a1-a1b5-f7e8226c13e9",
			now: () => new Date("2026-10-13T12:00:00Z"),
			includeErrorMessages: overrides.includeErrorMessages,
			onDiagnostic: overrides.onDiagnostic,
		}),
	}
}

describe("TelemetryReporter", () => {
	it("sends a stable bounded payload without message or stack by default", async () => {
		const fixture = reporter()
		const error = Object.assign(new Error("bearer secret-value"), { code: "network_failure" })

		assert.equal(await fixture.reporter.report(error, {
			operation: "chat.send",
			annotations: [
				{ provenance: "user", context: "clicked send after reconnect" },
				{ provenance: "agent", context: "token=agent-secret while replaying" },
			],
		}), true)

		assert.equal(fixture.calls.length, 1)
		assert.equal(fixture.calls[0].path, "/sdk/telemetry/errors")
		assert.deepEqual(fixture.calls[0].body, {
			eventId: "0199e5a8-d13d-70a1-a1b5-f7e8226c13e9",
			occurredAt: "2026-10-13T12:00:00.000Z",
			sessionId: "0199e5a7-5f52-7d85-997b-2c5150a97523",
			runtime: {
				integrationId: "example-game",
				sdk: { name: "haiven-js", version: "0.1.0" },
				platform: "web",
				environment: "production",
			},
			error: { type: "Error", code: "network_failure", operation: "chat.send" },
			annotations: [
				{ provenance: "user", context: "clicked send after reconnect" },
				{ provenance: "agent", context: "token=[REDACTED] while replaying" },
			],
		})
		assert.equal("stack" in (fixture.calls[0].body as Record<string, unknown>), false)
	})

	it("includes only explicitly enabled and sanitised message text", async () => {
		const fixture = reporter({ includeErrorMessages: true })
		await fixture.reporter.report(new Error("failed with bearer abc.def"), { operation: "session.open" })

		const body = fixture.calls[0].body as { error: { message?: string } }
		assert.equal(body.error.message, "failed with bearer [REDACTED]")
	})

	it("bounds UTF-8 text by bytes", async () => {
		const fixture = reporter()
		await fixture.reporter.report(new Error("ignored"), {
			operation: "x".repeat(80),
			message: "🙂".repeat(100),
		})

		const body = fixture.calls[0].body as { error: { operation: string; message?: string } }
		assert.equal(Buffer.byteLength(body.error.operation), 64)
		assert.equal(Buffer.byteLength(body.error.message ?? ""), 256)
	})

	it("absorbs transport and diagnostic callback failures", async () => {
		const diagnostics: TelemetryDiagnostic[] = []
		const fixture = reporter({
			request: async () => { throw new Error("offline") },
			onDiagnostic: (diagnostic) => {
				diagnostics.push(diagnostic)
				throw new Error("observer failed")
			},
		})

		assert.equal(await fixture.reporter.report(new Error("original"), { operation: "chat.send" }), false)
		assert.equal(diagnostics[0].kind, "report-failed")
	})

	it("rejects excess annotations locally without sending", async () => {
		const diagnostics: TelemetryDiagnostic[] = []
		const fixture = reporter({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) })
		const annotations = Array.from({ length: 5 }, () => ({
			provenance: "agent" as const,
			context: "context",
		}))

		assert.equal(await fixture.reporter.report(new Error("original"), {
			operation: "chat.send",
			annotations,
		}), false)
		assert.equal(fixture.calls.length, 0)
		assert.equal(diagnostics[0].kind, "invalid-input")
	})

	// The wire model leaves both fields optional, so an incomplete annotation
	// type-checks and has to be refused here instead.
	it("rejects an annotation missing its context locally without sending", async () => {
		const diagnostics: TelemetryDiagnostic[] = []
		const fixture = reporter({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) })

		assert.equal(await fixture.reporter.report(new Error("original"), {
			operation: "chat.send",
			annotations: [{ provenance: "user" }],
		}), false)
		assert.equal(fixture.calls.length, 0)
		assert.equal(diagnostics[0].kind, "invalid-input")
	})

	it("capture rethrows the same failure without waiting for telemetry", async () => {
		let reportStarted = false
		const fixture = reporter({
			request: async () => {
				reportStarted = true
				return await new Promise(() => {})
			},
		})
		const original = new Error("original")

		await assert.rejects(
			fixture.reporter.capture("chat.send", async () => { throw original }),
			(error) => error === original,
		)
		assert.equal(reportStarted, true)
	})

	it("capture returns successful work without reporting", async () => {
		const fixture = reporter()
		assert.equal(await fixture.reporter.capture("chat.send", async () => 42), 42)
		assert.equal(fixture.calls.length, 0)
	})
})
