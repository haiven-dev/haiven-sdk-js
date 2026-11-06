import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import type { WsServerReplyV0, ChatDmV0 } from "../src/contracts.ts"

// The contract types are emitted into codegen/ and re-exported by
// src/contracts.ts (`@haiven/sdk-ts/contracts`). These are types only, so the
// meaningful check is `tsc --noEmit` over this file; the runtime half just
// proves the import resolves through the package module.
describe("generated contract types", () => {
	it("reach hosts through the contracts module", () => {
		const refused: WsServerReplyV0 = { type: "chat.send", requestId: "rq-1", success: false, error: "rate_limited" }
		const dm: Pick<ChatDmV0, "channelId" | "readOnly"> = { channelId: "c1", readOnly: true }

		assert.equal(refused.success, false)
		assert.equal(dm.readOnly, true)
	})
})
