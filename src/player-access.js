/** The first published player-status code. Status codes remain an open vocabulary. */
export const FOUNDER_STATUS = "founder";
/**
 * Reads whether the signed-in player may launch a game.
 *
 * The generated transport remains authoritative: a successful response without a
 * body stays `null`, and `RestError` (including an unlisted code) is not
 * caught or remapped here.
 */
export function getGameAccess(api, gameId) {
    return api.getGamesGameIdAccess({ gameId });
}
/** Finds an exact open status code without rejecting codes minted after this SDK. */
export function findPlayerStatus(eligibility, code) {
    if (!code)
        return undefined;
    return eligibility?.statuses?.find((status) => status.code === code);
}
/** The founder status, independent of subscriber eligibility. */
export function founderStatus(eligibility) {
    return findPlayerStatus(eligibility, FOUNDER_STATUS);
}
