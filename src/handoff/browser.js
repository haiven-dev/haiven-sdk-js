import { KeyValueHandoffTransactionStore, webCryptoHandoffCrypto, } from "./core.js";
/** Browser profile: Web Crypto, sessionStorage, and same-tab navigation. */
export function browserHandoffHost(options = {}) {
    const globals = globalThis;
    const crypto = options.crypto ?? globals.crypto;
    if (!crypto)
        throw new Error("The browser handoff profile requires Web Crypto.");
    const transactions = options.transactions ??
        new KeyValueHandoffTransactionStore(options.storage ?? required(globals.sessionStorage, "sessionStorage"));
    const launchUrl = options.openUrl ?? ((url) => required(globals.location, "location").assign(url));
    return { profile: "browser", transactions, launchUrl, ...webCryptoHandoffCrypto(crypto) };
}
function required(value, name) {
    if (value === undefined)
        throw new Error(`The browser handoff profile requires ${name}.`);
    return value;
}
