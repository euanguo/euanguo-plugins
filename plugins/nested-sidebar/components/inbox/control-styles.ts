/**
 * The two faces of a control that can be held on.
 *
 * A toggle that is on wears a primary tint; the generic hover treatment —
 * neutral fill, foreground text — is for the off state only. Written out in one
 * place because the same inversion appeared in three of them: the view menu,
 * the feature selector and the selection toggle all lost their blue the moment
 * the pointer arrived, which reads as the control turning itself off.
 *
 * `focus-visible` follows the same split for the same reason: the view menu
 * keeps focus after its menu closes, and a neutral focus fill made a button
 * that was still on look off.
 */
export const TOGGLE_ON_CLASS =
  "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary focus-visible:bg-primary/15 focus-visible:text-primary";

/** The neutral treatment, for the same control while it is off. */
export const TOGGLE_OFF_CLASS =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground";
