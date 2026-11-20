// JSON decoding that refuses to round an integer.
//
// `JSON.parse` reads every number as an IEEE-754 double, so an integer literal
// beyond 2^53 - 1 arrives as a *different* integer with no error: 2^53 + 1
// decodes as 2^53. The C++, Unreal and C# SDKs carry such a value exactly; this
// one cannot, so it refuses the whole document with a finite SDK-local code
// instead of handing the caller a silently wrong number.
//
// 2^53 itself is refused too. It is exactly representable, but it is also what
// 2^53 + 1 rounds to, so a decoded 2^53 cannot be trusted to be the value that
// was sent. The bound is `Number.MAX_SAFE_INTEGER`, in both signs.
//
// Only integer literals are checked: a number with a fraction or an exponent is
// a float on the wire and is decoded as one. Every id the backend sends is
// already a string, so today this guards a latent risk rather than a known one.
export const INTEGER_PRECISION_EXCEEDED = "integer_precision_exceeded";
/** A document this SDK refused to decode. Branch on `code`, not the message. */
export class DecodeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "DecodeError";
        this.code = code;
    }
}
const MAX_SAFE_DIGITS = String(Number.MAX_SAFE_INTEGER); // "9007199254740991", 16 digits
/** Whether an unsigned run of decimal digits exceeds 2^53 - 1. */
function exceedsSafeInteger(digits) {
    if (digits.length !== MAX_SAFE_DIGITS.length)
        return digits.length > MAX_SAFE_DIGITS.length;
    return digits > MAX_SAFE_DIGITS;
}
/**
 * The first integer literal in a JSON text whose magnitude exceeds 2^53 - 1, or
 * undefined. Expects text `JSON.parse` has already accepted.
 */
export function findUnsafeInteger(text) {
    // Fast path: no run of 16 digits, no literal large enough to matter.
    if (!/\d{16}/.test(text))
        return undefined;
    const length = text.length;
    let index = 0;
    while (index < length) {
        const char = text.charCodeAt(index);
        if (char === 0x22 /* " */) {
            // Skip a string, escapes included: digits inside one are not numbers.
            index++;
            while (index < length) {
                const inner = text.charCodeAt(index);
                if (inner === 0x5c /* \ */)
                    index += 2;
                else if (inner === 0x22)
                    break;
                else
                    index++;
            }
            index++;
            continue;
        }
        if (char === 0x2d /* - */ || (char >= 0x30 && char <= 0x39)) {
            const start = index;
            if (char === 0x2d)
                index++;
            const digitsStart = index;
            while (index < length && isDigit(text.charCodeAt(index)))
                index++;
            const digitsEnd = index;
            let integer = true;
            while (index < length) {
                const next = text.charCodeAt(index);
                if (next === 0x2e /* . */ || next === 0x65 /* e */ || next === 0x45 /* E */)
                    integer = false;
                else if (!(isDigit(next) || next === 0x2b /* + */ || next === 0x2d))
                    break;
                index++;
            }
            if (integer && exceedsSafeInteger(text.slice(digitsStart, digitsEnd))) {
                return text.slice(start, digitsEnd);
            }
            continue;
        }
        index++;
    }
    return undefined;
}
function isDigit(char) {
    return char >= 0x30 && char <= 0x39;
}
/**
 * `JSON.parse`, except that an integer literal beyond 2^53 - 1 throws a
 * {@link DecodeError} with code `integer_precision_exceeded` instead of being
 * rounded. Malformed JSON still throws `SyntaxError`, as before.
 */
export function decodeJson(text) {
    const value = JSON.parse(text);
    const unsafe = findUnsafeInteger(text);
    if (unsafe !== undefined) {
        throw new DecodeError(INTEGER_PRECISION_EXCEEDED, `integer ${unsafe} exceeds 2^53 - 1 and cannot be decoded without rounding`);
    }
    return value;
}
