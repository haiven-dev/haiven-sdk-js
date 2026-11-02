import {
	MemoryHandoffTransactionStore,
	type HandoffHost,
	type HandoffTransactionStore,
	type WebCryptoLike,
	webCryptoHandoffCrypto,
} from "./core.ts"

export type NodeHandoffHostOptions = {
	crypto?: WebCryptoLike
	transactions?: HandoffTransactionStore
	/** Leave absent when the embedding process returns the URL to its own launcher. */
	openUrl?: (url: string) => void | Promise<void>
}

/** Node profile: built-in Web Crypto, memory-only verifier state, injected launcher. */
export function nodeHandoffHost(options: NodeHandoffHostOptions = {}): HandoffHost {
	const crypto = options.crypto ?? (globalThis.crypto as WebCryptoLike | undefined)
	if (!crypto) throw new Error("The Node handoff profile requires Web Crypto.")
	return {
		profile: "node",
		transactions: options.transactions ?? new MemoryHandoffTransactionStore(),
		launchUrl: options.openUrl,
		...webCryptoHandoffCrypto(crypto),
	}
}
