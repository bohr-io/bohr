/**
 * Steps of the demo chat: 0 empty, 1 request, 2 agent working, 3 staging preview,
 * 4 "Approve" tapped, 5 published. The final step is what the server renders and
 * what reduced-motion users see, fully visible and static.
 */
export const FINAL_STEP = 5;

/** Time spent on each step before moving on; the last entry holds the finished chat before it loops. */
export const STEP_DELAYS = [700, 1500, 2600, 1700, 1100, 5200] as const;

/** One full loop, back to the empty chat. */
export const LOOP_DURATION = STEP_DELAYS.reduce((total, delay) => total + delay, 0);
