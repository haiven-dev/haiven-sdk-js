// The extracted repository sits directly in the parent that also holds
// the server checkout. Paths copied from the SDK repository/ts still climbed one extra
// directory and still said `backend`, so live tests and the swagger extractor
// looked beside the workspace instead of beside this checkout.

import { spawnSync } from "node:child_process"
import { strict as assert } from "node:assert"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import { DEFAULT_SOURCE } from "../scripts/extract-swagger.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const siblingBackend = path.resolve(repoRoot, "../server-checkout")

describe("the server checkout sibling paths", () => {
	it("resolves the live backend checkout beside this repository", () => {
		const env = { ...process.env }
		delete env.HAIVEN_BACKEND
		const live = pathToFileURL(path.join(repoRoot, "src/ws/live.ts")).href
		const probe = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				`import { backendDir } from ${JSON.stringify(live)};
				 process.stdout.write(backendDir);`,
			],
			{ cwd: repoRoot, env, encoding: "utf8" },
		)
		assert.equal(probe.status, 0, probe.stderr)
		assert.equal(probe.stdout, siblingBackend)
	})

	it("reads swag output from that same sibling", () => {
		const script = new URL("../scripts/extract-swagger.mjs", import.meta.url)
		const resolved = path.resolve(new URL(DEFAULT_SOURCE, script).pathname)
		assert.equal(resolved, path.join(siblingBackend, "cmd/server/docs/docs.go"))
	})
})
