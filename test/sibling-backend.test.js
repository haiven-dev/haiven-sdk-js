// The extracted repository sits directly in the parent that also holds
// haiven-api. Paths copied from haiven-sdk still climb more directories than a
// standalone checkout has, so live tests and the swagger extractor would look
// beside the workspace instead of beside this checkout.
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SOURCE } from "../scripts/extract-swagger.mjs";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingApi = path.resolve(repoRoot, "../haiven-api");
describe("haiven-api sibling paths", () => {
    it("resolves the live API checkout beside this repository", () => {
        const env = { ...process.env };
        delete env.HAIVEN_API_ROOT;
        const live = pathToFileURL(path.join(repoRoot, "src/ws/live.js")).href;
        const probe = spawnSync(process.execPath, [
            "--input-type=module",
            "--eval",
            `import { backendDir } from ${JSON.stringify(live)};
				 process.stdout.write(backendDir);`,
        ], { cwd: repoRoot, env, encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        assert.equal(probe.stdout, siblingApi);
    });
    it("reads swag output from that same sibling", () => {
        const script = new URL("../scripts/extract-swagger.mjs", import.meta.url);
        const resolved = path.resolve(new URL(DEFAULT_SOURCE, script).pathname);
        assert.equal(resolved, path.join(siblingApi, "cmd/server/docs/docs.go"));
    });
});
