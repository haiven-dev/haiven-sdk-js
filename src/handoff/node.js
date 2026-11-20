import { MemoryHandoffTransactionStore, webCryptoHandoffCrypto, } from "./core.js";
/** Node profile: built-in Web Crypto, memory-only verifier state, injected launcher. */
export function nodeHandoffHost(options = {}) {
    const crypto = options.crypto ?? globalThis.crypto;
    if (!crypto)
        throw new Error("The Node handoff profile requires Web Crypto.");
    return {
        profile: "node",
        transactions: options.transactions ?? new MemoryHandoffTransactionStore(),
        launchUrl: options.openUrl,
        ...webCryptoHandoffCrypto(crypto),
    };
}
