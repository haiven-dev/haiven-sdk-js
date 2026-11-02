// The live half of the socket spike: the same client, driven against the real
// backend instead of the model in fake-server.ts.
//
// `../../../backend/cmd/wsfixture` runs the real websocket stack — handler,
// manager, cache subscriber, router, read loop, write pump — with the identity
// provider, the one user row and the pub/sub broker stubbed. Nothing about the
// protocol is stubbed, so what this file observes is evidence about the server
// rather than a reading of it.
//
// Two control endpoints replace the wall-clock wait a real expiry would need:
// `token(ttl)` accepts a negative ttl (inside the verifier's 30s leeway, so the
// token verifies while the session it mints is already expired), and `push()`
// publishes a server-originated frame down the same user channel a downstream
// service would.

import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { ClientFrame, RawServerFrame, SocketLike } from "./protocol.ts"

const here = path.dirname(fileURLToPath(import.meta.url))

/** Sibling `haiven-backend`, one repository up from this checkout's `src/ws`. */
// The directory was `backend` before the rename. One extra `..` walks out of
// the parent that holds the sibling checkouts, so a missing backend is reported
// at the wrong place and every live and conformance scenario skips.
export const backendDir = process.env.HAIVEN_BACKEND ?? path.resolve(here, "../../../haiven-backend")

/**
 * Why the live tests may not run here.
 *
 * They are skipped rather than failed when the backend checkout or the Go
 * toolchain is absent: this repository is a spike and its model-driven tests
 * must stay runnable on their own. A skip is reported, never silent.
 */
export async function liveUnavailable(): Promise<string | undefined> {
	try {
		await access(path.join(backendDir, "cmd", "wsfixture", "main.go"))
	} catch {
		return `backend checkout not found at ${backendDir}`
	}

	const probe = spawn("go", ["version"], { stdio: "ignore" })
	const [code] = (await once(probe, "close")) as [number | null]

	return code === 0 ? undefined : "go toolchain not available"
}

type Startup = {
	baseUrl: string
	wsUrl: string
	userId: string
	cognitoSub: string
	/** The write pump's parked-frame bound, published so tests do not restate it. */
	pendingLimit: number
}

export class LiveFixture {
	readonly info: Startup
	private readonly child: ChildProcess
	private readonly buildDir: string

	// Written out rather than declared as parameter properties: Node runs these
	// sources by stripping types, and that syntax needs a real compile step.
	private constructor(info: Startup, child: ChildProcess, buildDir: string) {
		this.info = info
		this.child = child
		this.buildDir = buildDir
	}

	static async start(): Promise<LiveFixture> {
		const buildDir = await mkdtemp(path.join(tmpdir(), "wsfixture-"))
		const binary = path.join(buildDir, "wsfixture")

		const build = spawn("go", ["build", "-o", binary, "./cmd/wsfixture"], {
			cwd: backendDir,
			stdio: ["ignore", "ignore", "pipe"],
		})
		let buildErr = ""
		build.stderr?.on("data", (chunk) => (buildErr += String(chunk)))
		const [buildCode] = (await once(build, "close")) as [number | null]
		if (buildCode !== 0) {
			await rm(buildDir, { recursive: true, force: true })
			throw new Error(`go build failed: ${buildErr.trim()}`)
		}

		const child = spawn(binary, ["-addr", "127.0.0.1:0"], {
			stdio: ["ignore", "pipe", "pipe"],
		})

		const info = await readStartup(child)

		return new LiveFixture(info, child, buildDir)
	}

	/**
	 * A signed access token. `ttl` is a Go duration; negative values are the
	 * point of the endpoint — see the note at the top of this file.
	 */
	async token(ttl = "1h"): Promise<string> {
		const res = await fetch(`${this.info.baseUrl}/control/token?ttl=${encodeURIComponent(ttl)}`)
		if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`)
		const body = (await res.json()) as { token: string }
		return body.token
	}

	/** Publish a server-originated frame to this fixture's user. */
	async push(frame: { type: string; payload?: unknown; count?: number }): Promise<void> {
		const res = await fetch(`${this.info.baseUrl}/control/push`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(frame),
		})
		if (!res.ok) throw new Error(`push ${res.status}: ${await res.text()}`)
	}

	/** A `SocketLike` over a real WebSocket to the fixture. */
	socket(): NodeSocket {
		return new NodeSocket(this.info.wsUrl)
	}

	/** A raw transcript client, for assertions that must not run through `Session`. */
	async client(): Promise<LiveClient> {
		const client = new LiveClient(this.info.wsUrl)
		await client.opened
		return client
	}

	async stop(): Promise<void> {
		this.child.kill("SIGTERM")
		await once(this.child, "close")
		await rm(this.buildDir, { recursive: true, force: true })
	}
}

async function readStartup(child: ChildProcess): Promise<Startup> {
	let stdout = ""
	let stderr = ""
	child.stderr?.on("data", (chunk) => (stderr += String(chunk)))

	return new Promise<Startup>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL")
			reject(new Error(`wsfixture did not announce in 20s: ${stderr}`))
		}, 20_000)

		child.on("close", (code) => {
			clearTimeout(timer)
			reject(new Error(`wsfixture exited (${code}): ${stderr}`))
		})

		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
			const newline = stdout.indexOf("\n")
			if (newline === -1) return
			clearTimeout(timer)
			child.removeAllListeners("close")
			resolve(JSON.parse(stdout.slice(0, newline)) as Startup)
		})
	})
}

/**
 * `SocketLike` over Node's global `WebSocket`.
 *
 * The adapter is four assignments, which is itself the finding: the injected
 * transport in `protocol.ts` was designed against a browser `WebSocket`, and a
 * runtime that ships the same interface needs no shim at all.
 */
export class NodeSocket implements SocketLike {
	onmessage: ((event: { data: string }) => void) | null = null
	onclose: ((event: { code: number; reason: string }) => void) | null = null
	onerror: ((event: unknown) => void) | null = null

	/**
	 * Latched, and that is not optional.
	 *
	 * `Session` attaches its handlers in its constructor, which runs after the
	 * socket was created — and a real socket can already be open by then. A
	 * browser-style `onopen` is edge-triggered and simply loses that, so the
	 * session sits in `pending` forever with a live socket underneath it. The
	 * model never showed this because it only fires `open()` when a test says so.
	 *
	 * Every binding that injects its transport has to solve this, in whatever
	 * the local idiom is. It belongs in the conformance corpus.
	 */
	get onopen(): (() => void) | null {
		return this.openHandler
	}

	set onopen(handler: (() => void) | null) {
		this.openHandler = handler
		if (this.isOpen && handler) handler()
	}

	private readonly ws: WebSocket
	private openHandler: (() => void) | null = null
	private isOpen = false

	constructor(url: string) {
		this.ws = new WebSocket(url)
		this.ws.onopen = () => {
			this.isOpen = true
			this.openHandler?.()
		}
		this.ws.onmessage = (event) => this.onmessage?.({ data: String(event.data) })
		this.ws.onclose = (event) => this.onclose?.({ code: event.code, reason: event.reason })
		this.ws.onerror = (event) => this.onerror?.(event)
	}

	send(data: string): void {
		this.ws.send(data)
	}

	close(code = 1000, reason = ""): void {
		this.ws.close(code, reason)
	}
}

export type CloseInfo = { code: number; reason: string }

/**
 * A socket that records the transcript and hands frames back one at a time.
 *
 * `Session` re-authenticates the moment it sees `auth.expired`, which is the
 * right client behaviour and the wrong instrument for measuring what the server
 * sent: the reply races the next assertion. Scenarios about server output use
 * this instead.
 */
export class LiveClient {
	readonly frames: RawServerFrame[] = []
	readonly opened: Promise<void>

	private readonly ws: WebSocket
	/**
	 * Frames that have arrived but not yet been read by `next`/`until`.
	 *
	 * Kept apart from `frames` because a real socket delivers whenever it likes:
	 * two frames written back to back arrive in one turn of the event loop, and a
	 * reader that only ever waits for the *next* arrival misses the second one
	 * and then blocks forever. The model never showed this either.
	 */
	private readonly unread: RawServerFrame[] = []
	private readonly waiting: Array<(frame: RawServerFrame) => void> = []
	private closeInfo: CloseInfo | undefined
	private resolveClosed!: (info: CloseInfo) => void
	readonly closed: Promise<CloseInfo>

	constructor(url: string) {
		this.ws = new WebSocket(url)
		this.closed = new Promise<CloseInfo>((resolve) => (this.resolveClosed = resolve))
		this.opened = new Promise<void>((resolve, reject) => {
			this.ws.onopen = () => resolve()
			this.ws.onerror = () => reject(new Error("socket failed to open"))
		})

		this.ws.onmessage = (event) => {
			const frame = JSON.parse(String(event.data)) as RawServerFrame
			this.frames.push(frame)
			const waiter = this.waiting.shift()
			if (waiter) waiter(frame)
			else this.unread.push(frame)
		}
		this.ws.onclose = (event) => {
			this.closeInfo = { code: event.code, reason: event.reason }
			this.resolveClosed(this.closeInfo)
		}
	}

	send(frame: ClientFrame): void {
		this.ws.send(JSON.stringify(frame))
	}

	/** The next unread frame, in arrival order. */
	next(timeoutMs = 5_000): Promise<RawServerFrame> {
		const buffered = this.unread.shift()
		if (buffered) return Promise.resolve(buffered)

		return new Promise<RawServerFrame>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`no frame within ${timeoutMs}ms (got ${this.frames.length})`)),
				timeoutMs,
			)
			this.waiting.push((frame) => {
				clearTimeout(timer)
				resolve(frame)
			})
		})
	}

	/** Frames until one satisfies `match`, inclusive. Fails rather than hangs. */
	async until(match: (frame: RawServerFrame) => boolean, timeoutMs = 5_000): Promise<RawServerFrame> {
		const deadline = Date.now() + timeoutMs
		for (;;) {
			const frame = await this.next(Math.max(1, deadline - Date.now()))
			if (match(frame)) return frame
		}
	}

	/**
	 * Wait `ms` for the socket to go quiet, then report what arrived during the
	 * wait. Used to assert an *absence* — the only way to show a frame was never
	 * processed is to wait and find nothing.
	 *
	 * Prefer reading `frames` after this returns when the frames of interest may
	 * have arrived before the call.
	 */
	async quiesce(ms = 250): Promise<RawServerFrame[]> {
		const before = this.frames.length
		await new Promise((resolve) => setTimeout(resolve, ms))
		return this.frames.slice(before)
	}

	/** Forget everything received so far, log and unread queue alike. */
	reset(): void {
		this.frames.length = 0
		this.unread.length = 0
	}

	get closeCode(): number | undefined {
		return this.closeInfo?.code
	}

	close(): void {
		if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000, "")
	}
}
