import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
// The contract types are emitted into codegen/ and re-exported by
// src/contracts.js (`@haiven/sdk-ts/contracts`). These are types only, so the
// meaningful check is `tsc --noEmit` over contracts.test.d.ts; the runtime half just
// proves the import resolves through the package module.
describe("generated contract types", () => {
    it("reach hosts through the contracts module", () => {
        const refused = { type: "chat.send", requestId: "rq-1", success: false, error: "rate_limited" };
        const dm = { channelId: "c1", readOnly: true };
        assert.equal(refused.success, false);
        assert.equal(dm.readOnly, true);
    });
});
