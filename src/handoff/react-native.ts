import {
	KeyValueHandoffTransactionStore,
	type HandoffCrypto,
	type HandoffHost,
	type HandoffKeyValueStore,
	type HandoffTransactionStore,
} from "./core.ts"

export type ReactNativeHandoffHostOptions = HandoffCrypto & {
	/** `Linking.openURL` without taking a dependency on React Native itself. */
	openUrl: (url: string) => void | Promise<unknown>
	/** AsyncStorage/SecureStore-shaped transient storage. */
	storage?: HandoffKeyValueStore
	transactions?: HandoffTransactionStore
}

/** React Native profile: platform crypto/linking/storage stay explicit injections. */
export function reactNativeHandoffHost(options: ReactNativeHandoffHostOptions): HandoffHost {
	if (!options.transactions && !options.storage) {
		throw new Error("The React Native handoff profile requires transient storage.")
	}
	return {
		profile: "react-native",
		transactions:
			options.transactions ?? new KeyValueHandoffTransactionStore(options.storage as HandoffKeyValueStore),
		launchUrl: async (url) => {
			await options.openUrl(url)
		},
		randomBytes: options.randomBytes,
		sha256: options.sha256,
	}
}
