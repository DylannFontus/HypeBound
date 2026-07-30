/**
 * Shared tuning for the press-and-hold gesture.
 *
 * The hand and the board both arm a drag and a peek on the same pointerdown,
 * because at that instant the two are indistinguishable. They must agree on
 * when a press becomes a hold, or the gesture would feel different depending on
 * where the card happens to be sitting.
 */

/** How long the pointer must stay down before the card blows up. */
export const HOLD_MS = 340;

/**
 * Movement past this many pixels means the player is dragging, not holding.
 * Generous enough to absorb hand tremor and trackpad jitter, tight enough that
 * a deliberate drag never reads as a hold.
 */
export const HOLD_TOLERANCE_PX = 9;
