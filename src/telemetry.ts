// The wire model, so the package publishes one TelemetryAnnotation, as every
// other SDK does. The contract leaves both fields optional; the reporter checks
// them below before sending.
import type { TelemetryAnnotation } from "./rest/generated.ts"

const maxNameBytes = 64
const maxTextBytes = 256
const maxAnnotations = 4
const utf8 = new TextEncoder()

export type TelemetryPlatform =
	| "unity"
	| "unreal"
	| "godot"
	| "web"
	| "node"
	| "react-native"
	| "roblox"

export type TelemetryEnvironment = "development" | "staging" | "production"

export type TelemetryRuntime = {
	integrationId: string
	sdk: { name: string; version: string }
	platform: TelemetryPlatform
	environment: TelemetryEnvironment
}

export type TelemetryErrorDetails = {
	/** Stable operation name such as `chat.send`; never a URL or request body. */
	operation: string
	/** Optional stable error code. An Error's string `code` is used when omitted. */
	code?: string
	/**
	 * Explicit message override. Supplying it opts this report into transmitting
	 * message text even when the reporter's `includeErrorMessages` is false.
	 */
	message?: string
	annotations?: readonly TelemetryAnnotation[]
}

export type TelemetryDiagnostic = {
	kind: "invalid-input" | "report-failed"
	error: unknown
}

export type TelemetryReporterOptions = {
	rest: TelemetryTransport
	runtime: TelemetryRuntime
	/** A caller-generated UUID grouping this process or gameplay session. */
	sessionId: string
	/** A fresh UUID for each report. Injected for portable and deterministic hosts. */
	eventId: () => string
	now?: () => Date
	/** Exception messages are omitted by default because they often contain data. */
	includeErrorMessages?: boolean
	/** Local-only observation. Exceptions from this callback are ignored. */
	onDiagnostic?: (diagnostic: TelemetryDiagnostic) => void
}

export type TelemetryTransport = {
	request(path: string, init: { method?: string; body?: unknown }): Promise<unknown>
}

type ErrorReport = {
	eventId: string
	occurredAt: string
	sessionId: string
	runtime: TelemetryRuntime
	error: {
		type: string
		code?: string
		message?: string
		operation: string
	}
	annotations?: TelemetryAnnotation[]
}

/**
 * Privacy-bounded SDK error reporting.
 *
 * `report` absorbs every reporting failure and returns false. `capture` starts a
 * report and immediately rethrows the exact original value, so telemetry can
 * neither replace the application failure nor make it wait on the network.
 */
export class TelemetryReporter {
	private readonly options: TelemetryReporterOptions

	constructor(options: TelemetryReporterOptions) {
		this.options = options
	}

	async report(error: unknown, details: TelemetryErrorDetails): Promise<boolean> {
		try {
			const request = this.toRequest(error, details)
			await this.options.rest.request("/sdk/telemetry/errors", {
				method: "POST",
				body: request,
			})
			return true
		} catch (reportingError) {
			this.diagnostic({
				kind: reportingError instanceof TelemetryInputError ? "invalid-input" : "report-failed",
				error: reportingError,
			})
			return false
		}
	}

	async capture<T>(
		operation: string,
		work: () => T | Promise<T>,
		details: Omit<TelemetryErrorDetails, "operation"> = {},
	): Promise<T> {
		try {
			return await work()
		} catch (error) {
			void this.report(error, { ...details, operation })
			throw error
		}
	}

	private toRequest(error: unknown, details: TelemetryErrorDetails): ErrorReport {
		if (details.annotations && details.annotations.length > maxAnnotations) {
			throw new TelemetryInputError(`at most ${maxAnnotations} annotations are allowed`)
		}

		const type = bounded(required(errorType(error), "error type"), maxNameBytes)
		const operation = bounded(required(details.operation, "operation"), maxNameBytes)
		const rawCode = details.code ?? errorCode(error)
		const rawMessage = details.message ?? (this.options.includeErrorMessages ? errorMessage(error) : undefined)
		const annotations = details.annotations?.map((annotation) => {
			if (annotation.provenance !== "user" && annotation.provenance !== "agent") {
				throw new TelemetryInputError("annotation provenance must be user or agent")
			}
			return {
				provenance: annotation.provenance,
				context: bounded(required(annotation.context ?? "", "annotation context"), maxTextBytes),
			}
		})
		const runtime = this.options.runtime

		return {
			eventId: this.options.eventId(),
			occurredAt: (this.options.now ?? (() => new Date()))().toISOString(),
			sessionId: this.options.sessionId,
			runtime: {
				integrationId: bounded(required(runtime.integrationId, "integration id"), maxNameBytes),
				sdk: {
					name: bounded(required(runtime.sdk.name, "sdk name"), maxNameBytes),
					version: bounded(required(runtime.sdk.version, "sdk version"), maxNameBytes),
				},
				platform: runtime.platform,
				environment: runtime.environment,
			},
			error: {
				type,
				operation,
				...(rawCode ? { code: bounded(rawCode, maxNameBytes) } : {}),
				...(rawMessage ? { message: bounded(rawMessage, maxTextBytes) } : {}),
			},
			...(annotations?.length ? { annotations } : {}),
		}
	}

	private diagnostic(diagnostic: TelemetryDiagnostic): void {
		try {
			this.options.onDiagnostic?.(diagnostic)
		} catch {
			// A local telemetry observer is diagnostic only and cannot alter control flow.
		}
	}
}

class TelemetryInputError extends Error {}

function errorType(error: unknown): string {
	if (error instanceof Error && error.name) return error.name
	return typeof error === "object" && error !== null ? "Error" : typeof error
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined
	const code = error.code
	if (typeof code === "string") return code
	if (typeof code === "object" && code !== null && "raw" in code && typeof code.raw === "string") {
		return code.raw
	}
	return undefined
}

function errorMessage(error: unknown): string | undefined {
	return error instanceof Error ? error.message : undefined
}

function required(value: string, field: string): string {
	const cleaned = sanitise(value.trim())
	if (!cleaned) throw new TelemetryInputError(`${field} is required`)
	return cleaned
}

function bounded(value: string, bytes: number): string {
	return truncateUtf8(sanitise(value), bytes)
}

function sanitise(value: string): string {
	return value
		.replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
		.replace(/((?:api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*)[^\s&,;]+/gi, "$1[REDACTED]")
}

function truncateUtf8(value: string, limit: number): string {
	if (utf8.encode(value).length <= limit) return value
	let result = ""
	let size = 0
	for (const character of value) {
		const next = utf8.encode(character).length
		if (size + next > limit) break
		result += character
		size += next
	}
	return result
}
