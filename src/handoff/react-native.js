import { KeyValueHandoffTransactionStore, } from "./core.js";
/** React Native profile: platform crypto/linking/storage stay explicit injections. */
export function reactNativeHandoffHost(options) {
    if (!options.transactions && !options.storage) {
        throw new Error("The React Native handoff profile requires transient storage.");
    }
    return {
        profile: "react-native",
        transactions: options.transactions ?? new KeyValueHandoffTransactionStore(options.storage),
        launchUrl: async (url) => {
            await options.openUrl(url);
        },
        randomBytes: options.randomBytes,
        sha256: options.sha256,
    };
}
