// Subscriber-reward claims with their confirmation. The
// TypeScript counterpart of the .NET RewardClaims and the C++ FRewardClaims,
// with the same rules, so a game behaves the same on every target.
//
// A player claims a reward with POST /users/me/rewards/claims under a claim id
// the client mints (a UUIDv7). The service records one claim per player, game and
// period, and answers a repeat of the same claim id with the claim it recorded,
// so a retry is safe only when it reuses the id. This keeps the id of every claim
// that has not had a final answer, keyed by integration and reward, and hands it
// to the next attempt; a final answer (recorded, or refused) releases it.
//
// A claim is `client_reported` until the game's server confirms it with its
// integration key (or grants it outright), after which it is `server_confirmed`.
// `refresh` reads a recorded claim's current confirmation by repeating it under
// its own claim id, which the service answers with the recorded claim and never
// records twice. Nothing here throws on a network or service failure: the outcome
// says what happened.
//
// `save` records `{claimId, rewardRef}` before the player links and does not
// post it. Pass `storage` to keep that id across launches. After the handoff,
// `submitSaved` posts it on the same user claim route. Loot is granted only
// when `result` is `claimed`. `clear` drops in-flight ids and leaves saved
// intents, so the next link submits the same claim id.
import { RestError } from "./rest/client.js";
export function memoryRewardClaimStore(initial = null) {
    return {
        document: initial,
        load() {
            return this.document;
        },
        save(document) {
            this.document = document;
        },
    };
}
/** Browser storage for saved claim intents. The document is claim ids, not a credential. */
export function browserRewardClaimStore(storage, integrationId) {
    const key = `haiven.reward-claims.${integrationId}`;
    return {
        load: () => storage.getItem(key),
        save: (document) => storage.setItem(key, document),
    };
}
/** An in-flight reward response arrived after {@link RewardClaims.clear} changed players. */
export class RewardClaimSessionChangedError extends Error {
    constructor() {
        super("the reward response belongs to a player session invalidated by clear()");
        this.name = "RewardClaimSessionChangedError";
    }
}
/** Subscriber-reward claims for the signed-in player, over a {@link RestClient}'s generated `endpoints`. */
export class RewardClaims {
    api;
    options;
    newClaimId;
    pendingIds = new Map();
    saved;
    sessionGeneration = 0;
    constructor(api, options) {
        if (!options.integrationId)
            throw new TypeError("an integrationId is required");
        this.api = api;
        this.options = options;
        this.newClaimId = options.claimId ?? newUuidV7;
        this.saved = loadSaved(options);
    }
    /** Whether the signed-in account may receive subscriber rewards. Branch on `eligible` or `basis`. */
    eligibility() {
        return this.api.getUsersMeRewardsEligibility();
    }
    /**
     * Claims one reward as `client_reported`, reusing the claim id of an earlier
     * attempt at it that had no final answer.
     */
    async claim(rewardRef) {
        if (!rewardRef || [...rewardRef].length > 128)
            throw new TypeError("a rewardRef must be 1 to 128 characters");
        const sessionGeneration = this.sessionGeneration;
        let claimId = this.pendingIds.get(rewardRef);
        if (claimId === undefined) {
            claimId = this.saved.find((item) => item.rewardRef === rewardRef)?.claimId;
            if (claimId === undefined)
                claimId = this.mintClaimId();
            this.pendingIds.set(rewardRef, claimId);
        }
        const outcome = await this.send(claimId, rewardRef, sessionGeneration);
        if (sessionGeneration !== this.sessionGeneration)
            throw new RewardClaimSessionChangedError();
        // Only the attempt that owns the id releases it.
        if (!outcome.retryable && this.pendingIds.get(rewardRef) === claimId)
            this.pendingIds.delete(rewardRef);
        if (!outcome.retryable)
            this.releaseSaved(rewardRef, claimId);
        return outcome;
    }
    /**
     * Records a claim intent before the player links. Reuses the claim id already
     * saved or pending for this reward. Does not post, and does not report `claimed`.
     */
    save(rewardRef) {
        if (!rewardRef || [...rewardRef].length > 128)
            throw new TypeError("a rewardRef must be 1 to 128 characters");
        const existing = this.saved.find((item) => item.rewardRef === rewardRef);
        const claimId = existing?.claimId ?? this.pendingIds.get(rewardRef) ?? this.mintClaimId();
        if (!existing) {
            this.saved.push({ claimId, rewardRef });
            this.persist();
        }
        return { claimId, integrationId: this.options.integrationId, rewardRef };
    }
    /** Saved intents in the order they were first recorded. */
    savedClaims() {
        return this.saved.map((item) => ({
            claimId: item.claimId,
            integrationId: this.options.integrationId,
            rewardRef: item.rewardRef,
        }));
    }
    /**
     * Posts every saved intent on POST /users/me/rewards/claims under the id
     * {@link save} kept. Call this after the login handoff. Only an outcome
     * whose `result` is `claimed` is loot.
     */
    async submitSaved() {
        const rewardRefs = this.saved.map((item) => item.rewardRef);
        const outcomes = [];
        for (const rewardRef of rewardRefs) {
            if (!this.saved.some((item) => item.rewardRef === rewardRef))
                continue;
            outcomes.push(await this.claim(rewardRef));
        }
        return outcomes;
    }
    /** Submits saved intents when the handoff stores a credential. */
    followHandoff(handoff) {
        handoff.onLinked(async () => {
            try {
                await this.submitSaved();
            }
            catch (error) {
                if (!(error instanceof RewardClaimSessionChangedError))
                    throw error;
            }
        });
    }
    /**
     * A recorded claim's current confirmation: the claim repeated under its own
     * claim id, which the service answers with the recorded claim (now
     * `server_confirmed` if the game's server confirmed it) and never records
     * twice.
     */
    refresh(claim) {
        if (!claim.claimId || !claim.rewardRef)
            throw new TypeError("a recorded claim with a claimId and rewardRef is required");
        return this.send(claim.claimId, claim.rewardRef, this.sessionGeneration);
    }
    /** The claim id the next claim of this reward will reuse, or undefined when it mints a new one. */
    pending(rewardRef) {
        return this.pendingIds.get(rewardRef);
    }
    /** Forgets every pending claim id: the player signed out. Saved intents stay. */
    clear() {
        this.pendingIds.clear();
        this.sessionGeneration++;
    }
    mintClaimId() {
        const claimId = this.newClaimId();
        if (!claimId)
            throw new TypeError("claim id generator returned an empty value");
        return claimId;
    }
    releaseSaved(rewardRef, claimId) {
        const index = this.saved.findIndex((item) => item.rewardRef === rewardRef && item.claimId === claimId);
        if (index < 0)
            return;
        this.saved.splice(index, 1);
        this.persist();
    }
    persist() {
        this.options.storage?.save(JSON.stringify(this.saved.map((item) => ({
            claimId: item.claimId,
            integrationId: this.options.integrationId,
            rewardRef: item.rewardRef,
        }))));
    }
    async send(claimId, rewardRef, sessionGeneration) {
        const outcome = await settle(() => this.api.postUsersMeRewardsClaims({
            body: { claimId, integrationId: this.options.integrationId, rewardRef },
        }));
        if (sessionGeneration !== this.sessionGeneration)
            throw new RewardClaimSessionChangedError();
        this.options.onSettled?.(outcome);
        // onSettled may call clear() and switch players. The check above has
        // already passed, so recheck before loot. Otherwise onClaimed grants
        // the previous player's claim, and the check below throws only after.
        if (sessionGeneration !== this.sessionGeneration)
            throw new RewardClaimSessionChangedError();
        if (outcome.result === "claimed")
            this.options.onClaimed?.(outcome);
        if (sessionGeneration !== this.sessionGeneration)
            throw new RewardClaimSessionChangedError();
        return outcome;
    }
}
function loadSaved(options) {
    const raw = options.storage?.load();
    if (!raw)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const saved = [];
    for (const item of parsed) {
        if (item === null || typeof item !== "object")
            continue;
        const record = item;
        if (typeof record.claimId !== "string" || record.claimId === "")
            continue;
        if (record.integrationId !== options.integrationId)
            continue;
        if (typeof record.rewardRef !== "string" || record.rewardRef === "" || [...record.rewardRef].length > 128)
            continue;
        if (saved.some((existing) => existing.rewardRef === record.rewardRef))
            continue;
        saved.push({ claimId: record.claimId, rewardRef: record.rewardRef });
    }
    return saved;
}
/**
 * A game server's grant of one reward to a player (POST /integrations/rewards/claims),
 * recorded as `server_confirmed`. `serverApi` must send the integration key in
 * `X-Haiven-Integration-Key` — a key that never ships in a game client. Keep
 * `claimId` across your own retries.
 */
export function grantReward(serverApi, grant) {
    if (!grant.userId || !grant.rewardRef || !grant.claimId)
        throw new TypeError("userId, rewardRef and claimId are required");
    return settle(() => serverApi.postIntegrationsRewardsClaims({ body: grant }));
}
/**
 * A game server's confirmation of a claim the player's client made
 * (POST /integrations/rewards/claims/{claim_id}/confirm), with the integration
 * key. Confirming twice returns the confirmed claim.
 */
export function confirmReward(serverApi, claimId) {
    if (!claimId)
        throw new TypeError("a claimId is required");
    return settle(() => serverApi.postIntegrationsRewardsClaimsClaimIdConfirm({ claimId }));
}
/** A recorded claim's confirmation; a value minted after this build is never read as confirmed. */
export function rewardConfirmation(confirmation) {
    return confirmation === "client_reported" || confirmation === "server_confirmed" ? confirmation : "unrecognized";
}
/** Any reward failure, by status and the error body's finite code. */
export function classifyRewardError(error) {
    if (!(error instanceof RestError))
        return { result: "failed", confirmation: "unrecognized", retryable: true, error };
    const status = error.status;
    const code = error.code?.value;
    const refused = (result) => ({
        result,
        confirmation: "unrecognized",
        status,
        retryable: false,
        error,
        ...(code === undefined ? {} : { code }),
    });
    if (status === 403 && code === "reward_not_eligible")
        return refused("not_eligible");
    if (status === 409 && code === "reward_already_claimed")
        return refused("already_claimed");
    if (status === 409 && code === "reward_claim_conflict")
        return refused("claim_conflict");
    if (status === 409 && code === "refund_in_progress")
        return refused("refund_in_progress");
    if (status === 404)
        return refused("not_found");
    return { ...refused("failed"), retryable: status === 429 || status >= 500 };
}
/** A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, the version, 74 random bits, the variant. */
export function newUuidV7() {
    if (globalThis.crypto?.getRandomValues === undefined) {
        throw new Error("secure random bytes are unavailable; inject RewardClaimsOptions.claimId");
    }
    return formatUuidV7(Date.now(), globalThis.crypto.getRandomValues(new Uint8Array(10)));
}
export function formatUuidV7(unixMilliseconds, random) {
    const bytes = new Uint8Array(16);
    let time = BigInt(unixMilliseconds);
    for (let index = 5; index >= 0; index--) {
        bytes[index] = Number(time & 0xffn);
        time >>= 8n;
    }
    bytes[6] = 0x70 | (random[0] & 0x0f);
    bytes[7] = random[1];
    bytes[8] = 0x80 | (random[2] & 0x3f);
    bytes.set(random.subarray(3, 10), 9);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function settle(send) {
    let claim;
    try {
        claim = await send();
    }
    catch (error) {
        return classifyRewardError(error);
    }
    // A 2xx that is not a claim may still have been recorded: retry under the same id.
    if (claim === null || typeof claim !== "object" || !claim.claimId) {
        return { result: "failed", confirmation: "unrecognized", retryable: true, error: new Error("the reward reply carried no claim") };
    }
    return { result: "claimed", claim, confirmation: rewardConfirmation(claim.confirmation), retryable: false };
}
