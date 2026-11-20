// Generated from the Haiven studio moderation HTTP API v0 OpenAPI description. Do not edit by hand.
export function decodeModerationObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new TypeError('moderation payload must be an object');
    return value;
}
