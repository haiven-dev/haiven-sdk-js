import { type HandoffHost, type HandoffTransactionStore, type WebCryptoLike } from "./core.js";
export type NodeHandoffHostOptions = {
    crypto?: WebCryptoLike;
    transactions?: HandoffTransactionStore;
    /** Leave absent when the embedding process returns the URL to its own launcher. */
    openUrl?: (url: string) => void | Promise<void>;
};
/** Node profile: built-in Web Crypto, memory-only verifier state, injected launcher. */
export declare function nodeHandoffHost(options?: NodeHandoffHostOptions): HandoffHost;
