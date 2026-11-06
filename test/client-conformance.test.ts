// Runner #1 of the client corpus: the TypeScript session against a scripted server.
//
// `gaming/v0` proves the server through a raw transcript. `gaming-client/v0`
// proves this binding: a scenario scripts exactly the frames the server sends,
// and asserts what the session wrote and what it handed to its caller. The
// socket is the injected `SocketLike`, driven synchronously, so a scenario is a
// deterministic sequence with no timing in it. The same file is executed by the
// dotnet, C++ and GDScript runners against their own session cores.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { Session } from "../src/ws/session.ts"
import type { ServerFrame, SocketLike } from "../src/ws/protocol.ts"

const SUITE = new URL(
	"../../../conformance/gaming-client/v0/generated/suite.json",
	import.meta.url,
).pathname

/** The names this runner answers to in a scenario's `waivers`. */
const RUNNER = "node"
const PROFILE = "gaming/node"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

type Step = {
	do: string
	type?: string
	payload?: Json
	frame?: Json
	bind?: string
	same?: string
	state?: string
	error?: string
}

type Scenario = {
	id: string
	title: string
	steps: Step[]
	waivers: Record<string, string>
}

const suite = JSON.parse(readFileSync(SUITE, "utf8")) as {
	lifecycle: string
	scenarios: Scenario[]
}

/** The transport a scenario drives: a socket whose far end is the script. */
class ScriptedSocket implements SocketLike {
	readonly sent: Record<string, Json>[] = []
	onmessage: ((event: { data: string }) => void) | null = null
	onclose: ((event: { code: number; reason: string }) => void) | null = null
	onerror: ((event: unknown) => void) | null = null
	onopen: (() => void) | null = null

	send(data: string): void {
		this.sent.push(JSON.parse(data) as Record<string, Json>)
	}

	close(): void {}
}

/** Replaces every `{"ref": alias}` with the request id bound to that alias. */
function resolve(value: Json, bound: Map<string, string>): Json {
	if (Array.isArray(value)) return value.map((item) => resolve(item, bound))
	if (value !== null && typeof value === "object") {
		const keys = Object.keys(value)
		if (keys.length === 1 && keys[0] === "ref" && typeof value.ref === "string") {
			const id = bound.get(value.ref)
			assert.ok(id !== undefined, `nothing is bound to ${value.ref}`)
			return id
		}
		return Object.fromEntries(keys.map((key) => [key, resolve(value[key] as Json, bound)]))
	}
	return value
}

function run(scenario: Scenario): void {
	const socket = new ScriptedSocket()
	const delivered: ServerFrame[] = []
	let counter = 0
	const session = new Session({
		socket,
		token: () => "scripted-token",
		requestId: () => `rq-${++counter}`,
		retainEvents: false,
		onEvent: (event) => {
			if (event.kind === "frame") delivered.push(event.frame)
		},
	})
	const bound = new Map<string, string>()
	let read = 0
	let seen = 0

	for (const [index, step] of scenario.steps.entries()) {
		const at = `step ${index + 1} (${step.do})`
		switch (step.do) {
			case "open":
				socket.onopen?.()
				break
			case "call":
				session.send(step.type as string, step.payload)
				break
			case "serve":
				socket.onmessage?.({ data: JSON.stringify(resolve(step.frame as Json, bound)) })
				break
			case "expectSent": {
				const frame = socket.sent[read++]
				assert.ok(frame !== undefined, `${at}: expected a ${step.type} and nothing was written`)
				assert.equal(frame.type, step.type, `${at}: wrote the wrong type`)
				const requestId = frame.requestId as string
				if (step.bind !== undefined) bound.set(step.bind, requestId)
				if (step.same !== undefined) assert.equal(requestId, bound.get(step.same), `${at}: not ${step.same}`)
				break
			}
			case "expectQuiet":
				assert.deepEqual(socket.sent.slice(read), [], `${at}: wrote more than the scenario expects`)
				break
			case "expectState":
				assert.equal(session.state, step.state, `${at}: wrong state`)
				break
			case "expectDelivered": {
				const offset = delivered.slice(seen).findIndex((frame) => frame.type === step.type)
				assert.ok(offset >= 0, `${at}: no ${step.type} was handed to the caller`)
				const frame = delivered[seen + offset]
				seen += offset + 1
				if (step.error !== undefined) assert.equal(frame.error?.value, step.error, `${at}: error code`)
				break
			}
			default:
				assert.fail(`${at}: unknown step`)
		}
	}
}

describe("the client conformance corpus, run by node", () => {
	const claimed = [RUNNER, PROFILE, suite.lifecycle]

	it("has scenarios to run", () => {
		assert.ok(suite.scenarios.length > 0)
	})

	for (const scenario of suite.scenarios) {
		const waiver = claimed.find((name) => name in scenario.waivers)
		it(`${scenario.id}: ${scenario.title}`, { skip: waiver && scenario.waivers[waiver] }, () => run(scenario))
	}
})
