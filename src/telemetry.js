const maxNameBytes = 64;
const maxTextBytes = 256;
const maxAnnotations = 4;
const utf8 = new TextEncoder();
/**
 * Privacy-bounded SDK error reporting.
 *
 * `report` absorbs every reporting failure and returns false. `capture` starts a
 * report and immediately rethrows the exact original value, so telemetry can
 * neither replace the application failure nor make it wait on the network.
 */
export class TelemetryReporter {
    options;
    constructor(options) {
        this.options = options;
    }
    async report(error, details) {
        try {
            const request = this.toRequest(error, details);
            await this.options.rest.request("/sdk/telemetry/errors", {
                method: "POST",
                body: request,
            });
            return true;
        }
        catch (reportingError) {
            this.diagnostic({
                kind: reportingError instanceof TelemetryInputError ? "invalid-input" : "report-failed",
                error: reportingError,
            });
            return false;
        }
    }
    async capture(operation, work, details = {}) {
        try {
            return await work();
        }
        catch (error) {
            void this.report(error, { ...details, operation });
            throw error;
        }
    }
    toRequest(error, details) {
        if (details.annotations && details.annotations.length > maxAnnotations) {
            throw new TelemetryInputError(`at most ${maxAnnotations} annotations are allowed`);
        }
        const type = bounded(required(errorType(error), "error type"), maxNameBytes);
        const operation = bounded(required(details.operation, "operation"), maxNameBytes);
        const rawCode = details.code ?? errorCode(error);
        const rawMessage = details.message ?? (this.options.includeErrorMessages ? errorMessage(error) : undefined);
        const annotations = details.annotations?.map((annotation) => {
            if (annotation.provenance !== "user" && annotation.provenance !== "agent") {
                throw new TelemetryInputError("annotation provenance must be user or agent");
            }
            return {
                provenance: annotation.provenance,
                context: bounded(required(annotation.context ?? "", "annotation context"), maxTextBytes),
            };
        });
        const runtime = this.options.runtime;
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
        };
    }
    diagnostic(diagnostic) {
        try {
            this.options.onDiagnostic?.(diagnostic);
        }
        catch {
            // A local telemetry observer is diagnostic only and cannot alter control flow.
        }
    }
}
class TelemetryInputError extends Error {
}
function errorType(error) {
    if (error instanceof Error && error.name)
        return error.name;
    return typeof error === "object" && error !== null ? "Error" : typeof error;
}
function errorCode(error) {
    if (typeof error !== "object" || error === null || !("code" in error))
        return undefined;
    const code = error.code;
    if (typeof code === "string")
        return code;
    if (typeof code === "object" && code !== null && "raw" in code && typeof code.raw === "string") {
        return code.raw;
    }
    return undefined;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : undefined;
}
function required(value, field) {
    const cleaned = sanitise(value.trim());
    if (!cleaned)
        throw new TelemetryInputError(`${field} is required`);
    return cleaned;
}
function bounded(value, bytes) {
    return truncateUtf8(sanitise(value), bytes);
}
function sanitise(value) {
    return value
        .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
        .replace(/((?:api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*)[^\s&,;]+/gi, "$1[REDACTED]");
}
function truncateUtf8(value, limit) {
    if (utf8.encode(value).length <= limit)
        return value;
    let result = "";
    let size = 0;
    for (const character of value) {
        const next = utf8.encode(character).length;
        if (size + next > limit)
            break;
        result += character;
        size += next;
    }
    return result;
}
