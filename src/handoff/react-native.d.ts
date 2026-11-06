import { type HandoffCrypto, type HandoffHost, type HandoffKeyValueStore, type HandoffTransactionStore } from "./core.js";
export type ReactNativeHandoffHostOptions = HandoffCrypto & {
    /** `Linking.openURL` without taking a dependency on React Native itself. */
    openUrl: (url: string) => void | Promise<unknown>;
    /** AsyncStorage/SecureStore-shaped transient storage. */
    storage?: HandoffKeyValueStore;
    transactions?: HandoffTransactionStore;
};
/** React Native profile: platform crypto/linking/storage stay explicit injections. */
export declare function reactNativeHandoffHost(options: ReactNativeHandoffHostOptions): HandoffHost;
