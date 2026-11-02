import {
	KeyValueHandoffTransactionStore,
	type HandoffHost,
	type HandoffKeyValueStore,
	type HandoffTransactionStore,
	type WebCryptoLike,
	webCryptoHandoffCrypto,
} from "./core.ts"

export type BrowserHandoffHostOptions = {
	crypto?: WebCryptoLike
	storage?: HandoffKeyValueStore
	transactions?: HandoffTransactionStore
	openUrl?: (url: string) => void
}

/** Browser profile: Web Crypto, sessionStorage, and same-tab navigation. */
export function browserHandoffHost(options: BrowserHandoffHostOptions = {}): HandoffHost {
	const globals = globalThis as typeof globalThis & {
		crypto?: WebCryptoLike
		sessionStorage?: HandoffKeyValueStore
		location?: { assign(url: string): void }
	}
	const crypto = options.crypto ?? globals.crypto
	if (!crypto) throw new Error("The browser handoff profile requires Web Crypto.")
	const transactions =
		options.transactions ??
		new KeyValueHandoffTransactionStore(
			options.storage ?? required(globals.sessionStorage, "sessionStorage"),
		)
	const launchUrl = options.openUrl ?? ((url: string) => required(globals.location, "location").assign(url))

	return { profile: "browser", transactions, launchUrl, ...webCryptoHandoffCrypto(crypto) }
}

function required<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`The browser handoff profile requires ${name}.`)
	return value
}
