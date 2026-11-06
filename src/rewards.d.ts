import { type RestApi, type RewardClaimResponse, type RewardEligibilityResponse } from "./rest/client.js";
/** How one reward claim, grant, or confirmation ended. */
export type RewardClaimResult = 
/** Recorded: a new claim, or the claim already recorded under the same claim id. */
"claimed"
/** The account holds no active Haiven subscription (`reward_not_eligible`). */
 | "not_eligible"
/** This player already claimed this reward in this period (`reward_already_claimed`). */
 | "already_claimed"
/** The claim id was used for a different claim (`reward_claim_conflict`). */
 | "claim_conflict"
/** The period is being refunded, so it takes no new claims (`refund_in_progress`). */
 | "refund_in_progress"
/** The claim to confirm does not exist, or belongs to another integration. */
 | "not_found"
/** Anything else: transport failure, server error, bad request, unreadable reply. */
 | "failed";
/** Who vouched for a claim. A value minted after this build is `unrecognized`, never confirmed. */
export type RewardConfirmation = "client_reported" | "server_confirmed" | "unrecognized";
/** One finished reward request. */
export type RewardClaimOutcome = {
    readonly result: RewardClaimResult;
    /** The recorded claim, when `result` is `claimed`. */
    readonly claim?: RewardClaimResponse;
    readonly confirmation: RewardConfirmation;
    /** The HTTP status of a refusal; absent on success or a transport failure. */
    readonly status?: number;
    /** The refusal's finite error code, verbatim. Branch on this, never on `error`'s message. */
    readonly code?: string;
    /** Claiming the same reward again may succeed, and reuses the claim id, so it cannot claim twice. */
    readonly retryable: boolean;
    /** What failed, for a log. */
    readonly error?: unknown;
};
/** A reward the player asked for before linking. Local only: not a recorded claim, and not loot. */
export type SavedRewardClaim = {
    readonly claimId: string;
    readonly integrationId: string;
    readonly rewardRef: string;
};
/** The JSON document of saved claim intents. One store belongs to one {@link RewardClaims}. */
export type RewardClaimIntentStore = {
    load(): string | null;
    save(document: string): void;
};
export declare function memoryRewardClaimStore(initial?: string | null): RewardClaimIntentStore & {
    document: string | null;
};
/** Browser storage for saved claim intents. The document is claim ids, not a credential. */
export declare function browserRewardClaimStore(storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}, integrationId: string): RewardClaimIntentStore;
export type RewardClaimsOptions = {
    /** The game's launch integration id, the one its login handoff uses. */
    integrationId: string;
    /**
     * Injected so tests are deterministic and native hosts can supply secure
     * randomness; defaults to {@link newUuidV7} in hosts with Web Crypto.
     */
    claimId?: () => string;
    /** Where saved intents survive a restart. Omitted, they last for this process. */
    storage?: RewardClaimIntentStore;
    /** Called for a recorded claim that still belongs to this player after `onSettled`, including a refreshed one. This is the loot signal. */
    onClaimed?: (outcome: RewardClaimOutcome) => void;
    /** Called for every submitted claim that still belongs to this player, including a refusal. A refusal is not loot. */
    onSettled?: (outcome: RewardClaimOutcome) => void;
};
/** An in-flight reward response arrived after {@link RewardClaims.clear} changed players. */
export declare class RewardClaimSessionChangedError extends Error {
    constructor();
}
/** Subscriber-reward claims for the signed-in player, over a {@link RestClient}'s generated `endpoints`. */
export declare class RewardClaims {
    private readonly api;
    private readonly options;
    private readonly newClaimId;
    private readonly pendingIds;
    private saved;
    private sessionGeneration;
    constructor(api: RestApi, options: RewardClaimsOptions);
    /** Whether the signed-in account may receive subscriber rewards. Branch on `eligible` or `basis`. */
    eligibility(): Promise<RewardEligibilityResponse | null>;
    /**
     * Claims one reward as `client_reported`, reusing the claim id of an earlier
     * attempt at it that had no final answer.
     */
    claim(rewardRef: string): Promise<RewardClaimOutcome>;
    /**
     * Records a claim intent before the player links. Reuses the claim id already
     * saved or pending for this reward. Does not post, and does not report `claimed`.
     */
    save(rewardRef: string): SavedRewardClaim;
    /** Saved intents in the order they were first recorded. */
    savedClaims(): readonly SavedRewardClaim[];
    /**
     * Posts every saved intent on POST /users/me/rewards/claims under the id
     * {@link save} kept. Call this after the login handoff. Only an outcome
     * whose `result` is `claimed` is loot.
     */
    submitSaved(): Promise<RewardClaimOutcome[]>;
    /** Submits saved intents when the handoff stores a credential. */
    followHandoff(handoff: {
        onLinked(listener: () => void | Promise<void>): void;
    }): void;
    /**
     * A recorded claim's current confirmation: the claim repeated under its own
     * claim id, which the service answers with the recorded claim (now
     * `server_confirmed` if the game's server confirmed it) and never records
     * twice.
     */
    refresh(claim: RewardClaimResponse): Promise<RewardClaimOutcome>;
    /** The claim id the next claim of this reward will reuse, or undefined when it mints a new one. */
    pending(rewardRef: string): string | undefined;
    /** Forgets every pending claim id: the player signed out. Saved intents stay. */
    clear(): void;
    private mintClaimId;
    private releaseSaved;
    private persist;
    private send;
}
/**
 * A game server's grant of one reward to a player (POST /integrations/rewards/claims),
 * recorded as `server_confirmed`. `serverApi` must send the integration key in
 * `X-Haiven-Integration-Key` — a key that never ships in a game client. Keep
 * `claimId` across your own retries.
 */
export declare function grantReward(serverApi: RestApi, grant: {
    userId: string;
    rewardRef: string;
    claimId: string;
}): Promise<RewardClaimOutcome>;
/**
 * A game server's confirmation of a claim the player's client made
 * (POST /integrations/rewards/claims/{claim_id}/confirm), with the integration
 * key. Confirming twice returns the confirmed claim.
 */
export declare function confirmReward(serverApi: RestApi, claimId: string): Promise<RewardClaimOutcome>;
/** A recorded claim's confirmation; a value minted after this build is never read as confirmed. */
export declare function rewardConfirmation(confirmation: string | undefined): RewardConfirmation;
/** Any reward failure, by status and the error body's finite code. */
export declare function classifyRewardError(error: unknown): RewardClaimOutcome;
/** A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, the version, 74 random bits, the variant. */
export declare function newUuidV7(): string;
export declare function formatUuidV7(unixMilliseconds: number, random: Uint8Array): string;
