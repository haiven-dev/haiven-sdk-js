import type { GameAccessResponse, PlayerStatus, RestApi, RewardEligibilityResponse } from "./rest/generated.js";
/** The first published player-status code. Status codes remain an open vocabulary. */
export declare const FOUNDER_STATUS = "founder";
/**
 * Reads whether the signed-in player may launch a game.
 *
 * The generated transport remains authoritative: a successful response without a
 * body stays `null`, and `RestError` (including an unlisted code) is not
 * caught or remapped here.
 */
export declare function getGameAccess(api: RestApi, gameId: number): Promise<GameAccessResponse | null>;
/** Finds an exact open status code without rejecting codes minted after this SDK. */
export declare function findPlayerStatus(eligibility: RewardEligibilityResponse | null | undefined, code: string): PlayerStatus | undefined;
/** The founder status, independent of subscriber eligibility. */
export declare function founderStatus(eligibility: RewardEligibilityResponse | null | undefined): PlayerStatus | undefined;
