// The HTTP half of the live tier: `cmd/moderationfixture` in the sibling
// `haiven-api` checkout, which is `backend-moderation-fixture/v0` — the
// fixture `haiven-contracts/conformance/sdk/moderation/v0` names.
//
// Where `../ws/live.ts` starts the real websocket stack and hands back a
// socket, this starts the real `/moderation/df` handlers and hands back a
// credential minter. The suite declares two capabilities and the fixture offers
// exactly those two:
//
//   - `token.roles`    — `/control/token?role=<role>` mints a Deliver Fund API
//                        key registered against that role.
//   - `studio.binding` — every minted credential is bound to a studio, and a
//                        request may address a different one, so a scenario can
//                        attempt to cross the binding.
//
// Nothing about the moderation surface is stubbed: the handler, the service and
// its API-key check are the real ones. The store, Deliver Fund and Google
// Sheets are the stubs. So what a scenario observes here is evidence about the
// server rather than a reading of it.

import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Deliberately imported rather than restated. `backendDir` carries the
// env-var override and the post-rename sibling path, and the last time that
// rule existed in two places one copy went stale and every live assertion
// skipped instead of failing. One definition, two protocols.
import { backendDir } from "../ws/live.ts"

/** One credential the fixture minted, and what it is bound to. */
export type Credential = {
	token: string
	role: string
	studio: string
}

/** What the fixture announces on stdout once it is listening. */
type Startup = {
	baseUrl: string
	/** The studio every credential is bound to unless a caller asks for another. */
	studio: string
}

/** One answered HTTP exchange. */
export type Answer = {
	status: number
	/** The decoded body, or `null` when the response carried none that parses. */
	body: Record<string, unknown> | null
}

/**
 * Why the moderation live tier may not run here.
 *
 * Reported, never silent — the same rule `liveUnavailable` follows, and for the
 * same reason: a suite whose absence is indistinguishable from its success is
 * not a suite.
 */
export async function moderationUnavailable(): Promise<string | undefined> {
	try {
		await access(path.join(backendDir, "cmd", "moderationfixture", "main.go"))
	} catch {
		return `backend checkout not found at ${backendDir}`
	}

	const probe = spawn("go", ["version"], { stdio: "ignore" })
	const [code] = (await once(probe, "close")) as [number | null]

	return code === 0 ? undefined : "go toolchain not available"
}

export class ModerationFixture {
	readonly info: Startup
	private readonly child: ChildProcess
	private readonly buildDir: string

	private constructor(info: Startup, child: ChildProcess, buildDir: string) {
		this.info = info
		this.child = child
		this.buildDir = buildDir
	}

	static async start(): Promise<ModerationFixture> {
		const buildDir = await mkdtemp(path.join(tmpdir(), "moderationfixture-"))
		const binary = path.join(buildDir, "moderationfixture")

		const build = spawn("go", ["build", "-o", binary, "./cmd/moderationfixture"], {
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

		const child = spawn(binary, ["-addr", "127.0.0.1:0"], { stdio: ["ignore", "pipe", "pipe"] })

		return new ModerationFixture(await readStartup(child), child, buildDir)
	}

	/**
	 * Mint a credential for a role, bound to a studio.
	 *
	 * The role is recorded against the key, which is what makes `token.roles` a
	 * capability the fixture genuinely offers rather than a label. The fixture
	 * does not answer refusals on the surface's behalf: if Backend does not read
	 * the role yet, a role-scoped scenario observes that, and the corpus records
	 * it as a waiver.
	 */
	async mint(role: string, studio?: string): Promise<Credential> {
		const query = new URLSearchParams({ role })
		if (studio !== undefined) query.set("studio", studio)

		const res = await fetch(`${this.info.baseUrl}/control/token?${query}`)
		if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`)

		const minted = (await res.json()) as Credential
		if (!minted.token) throw new Error("token endpoint returned no token")
		if (minted.role !== role) throw new Error(`asked for role "${role}", fixture minted "${minted.role}"`)
		return minted
	}

	/**
	 * Call one moderation operation with a credential and an addressed studio.
	 *
	 * `studio` is passed separately from the credential on purpose: addressing a
	 * studio the token was not minted for is the crossing `wrong-studio-is-rejected`
	 * makes, and folding it into the credential would make that crossing
	 * unexpressible.
	 */
	async call(method: string, urlPath: string, credential: Credential, studio: string, body?: unknown): Promise<Answer> {
		const headers: Record<string, string> = {
			"x-api-key": credential.token,
			"x-haiven-studio": studio,
		}
		if (body !== undefined) headers["content-type"] = "application/json"

		const res = await fetch(this.info.baseUrl + urlPath, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})

		// A response body is not required, and a non-object body is not an error:
		// only the fields a scenario names have to match.
		let decoded: Record<string, unknown> | null = null
		try {
			const parsed: unknown = JSON.parse(await res.text())
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				decoded = parsed as Record<string, unknown>
			}
		} catch {
			decoded = null
		}

		return { status: res.status, body: decoded }
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
			reject(new Error(`moderationfixture did not announce in 20s: ${stderr}`))
		}, 20_000)

		child.on("close", (code) => {
			clearTimeout(timer)
			reject(new Error(`moderationfixture exited (${code}): ${stderr}`))
		})

		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
			const newline = stdout.indexOf("\n")
			if (newline === -1) return
			clearTimeout(timer)
			child.removeAllListeners("close")
			const startup = JSON.parse(stdout.slice(0, newline)) as Startup
			if (!startup.baseUrl) return reject(new Error("moderationfixture announced no baseUrl"))
			// The studio is not decoration: every scenario addresses one, and a
			// fixture that does not say what it bound to makes the crossing
			// scenario unwritable.
			if (!startup.studio) return reject(new Error("moderationfixture announced no studio"))
			resolve(startup)
		})
	})
}

/**
 * Split a suite operation id (`http:POST:/moderation/df/events`) into its
 * method and path.
 *
 * Exported because it is the one piece of the runner that is worth testing
 * without a backend checkout: everything else needs the fixture, and this is
 * where a malformed id would otherwise turn into a request to a nonsense URL.
 */
export function operation(operationId: string): { method: string; path: string } {
	// Split on the first two colons only. A path may legitimately carry one, and
	// a split that counts them would reject an id the publisher considers valid.
	const scheme = operationId.indexOf(":")
	const separator = operationId.indexOf(":", scheme + 1)
	const method = scheme === -1 || separator === -1 ? "" : operationId.slice(scheme + 1, separator)
	const urlPath = separator === -1 ? "" : operationId.slice(separator + 1)

	if (operationId.slice(0, scheme) !== "http" || !method || !urlPath.startsWith("/")) {
		throw new Error(`operation id "${operationId}" is not http:<METHOD>:</path>`)
	}
	return { method, path: urlPath }
}
