import { type HandoffHost, type HandoffKeyValueStore, type HandoffTransactionStore, type WebCryptoLike } from "./core.js";
export type BrowserHandoffHostOptions = {
    crypto?: WebCryptoLike;
    storage?: HandoffKeyValueStore;
    transactions?: HandoffTransactionStore;
    openUrl?: (url: string) => void;
};
/** Browser profile: Web Crypto, sessionStorage, and same-tab navigation. */
export declare function browserHandoffHost(options?: BrowserHandoffHostOptions): HandoffHost;
