import type { TelemetryAnnotation } from "./rest/generated.js";
export type TelemetryPlatform = "unity" | "unreal" | "godot" | "web" | "node" | "react-native" | "roblox";
export type TelemetryEnvironment = "development" | "staging" | "production";
export type TelemetryRuntime = {
    integrationId: string;
    sdk: {
        name: string;
        version: string;
    };
    platform: TelemetryPlatform;
    environment: TelemetryEnvironment;
};
export type TelemetryErrorDetails = {
    /** Stable operation name such as `chat.send`; never a URL or request body. */
    operation: string;
    /** Optional stable error code. An Error's string `code` is used when omitted. */
    code?: string;
    /**
     * Explicit message override. Supplying it opts this report into transmitting
     * message text even when the reporter's `includeErrorMessages` is false.
     */
    message?: string;
    annotations?: readonly TelemetryAnnotation[];
};
export type TelemetryDiagnostic = {
    kind: "invalid-input" | "report-failed";
    error: unknown;
};
export type TelemetryReporterOptions = {
    rest: TelemetryTransport;
    runtime: TelemetryRuntime;
    /** A caller-generated UUID grouping this process or gameplay session. */
    sessionId: string;
    /** A fresh UUID for each report. Injected for portable and deterministic hosts. */
    eventId: () => string;
    now?: () => Date;
    /** Exception messages are omitted by default because they often contain data. */
    includeErrorMessages?: boolean;
    /** Local-only observation. Exceptions from this callback are ignored. */
    onDiagnostic?: (diagnostic: TelemetryDiagnostic) => void;
};
export type TelemetryTransport = {
    request(path: string, init: {
        method?: string;
        body?: unknown;
    }): Promise<unknown>;
};
/**
 * Privacy-bounded SDK error reporting.
 *
 * `report` absorbs every reporting failure and returns false. `capture` starts a
 * report and immediately rethrows the exact original value, so telemetry can
 * neither replace the application failure nor make it wait on the network.
 */
export declare class TelemetryReporter {
    private readonly options;
    constructor(options: TelemetryReporterOptions);
    report(error: unknown, details: TelemetryErrorDetails): Promise<boolean>;
    capture<T>(operation: string, work: () => T | Promise<T>, details?: Omit<TelemetryErrorDetails, "operation">): Promise<T>;
    private toRequest;
    private diagnostic;
}
