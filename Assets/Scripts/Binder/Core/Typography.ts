// Binder — the type scale. Pure, no Lens Studio runtime.
//
// Every label used to be size 32 with no exceptions, which is why the interface
// read as flat and hard to look at: no hierarchy, and below the legible floor.
//
// The scale below is Snap's, calibrated for a panel at 110 cm. Binder's panels
// sit at 150 cm, so sizes are scaled by distance/110 — a label 40% further away
// needs to be 40% larger to subtend the same angle. Caption is the floor; do not
// render readable text smaller.

export type TextRole =
  | 'Title1' | 'Title2' | 'HeadlineXL' | 'Headline1' | 'Headline2'
  | 'Subheadline' | 'Button' | 'Callout' | 'Body' | 'Caption';

/**
 * Size at the 110 cm reference distance, with the weight that belongs to it.
 * Size and weight travel together so they cannot drift apart.
 */
export const TYPE_SCALE: Record<TextRole, { size: number; weight: number }> = {
  Title1: { size: 105, weight: 700 },
  Title2: { size: 93, weight: 700 },
  HeadlineXL: { size: 62, weight: 700 },
  Headline1: { size: 54, weight: 700 },
  Headline2: { size: 48, weight: 700 },
  Subheadline: { size: 41, weight: 700 },
  Callout: { size: 39, weight: 700 },
  Button: { size: 39, weight: 500 },
  Body: { size: 39, weight: 500 },
  Caption: { size: 38, weight: 500 },
};

/** The distance the scale is calibrated for. */
export const REFERENCE_DISTANCE_CM = 110;

/** Where Binder's panels actually sit, and so the default for its labels. */
export const PANEL_DISTANCE_CM = 150;

/**
 * Size for a role at a given viewing distance. Rounded because the text
 * component takes whole numbers and a fractional size is meaningless.
 */
export function roleSize(role: TextRole, distanceCm = PANEL_DISTANCE_CM): number {
  return Math.round(TYPE_SCALE[role].size * (distanceCm / REFERENCE_DISTANCE_CM));
}

/** Weight for a role. Bold for headings, medium for body and buttons. */
export function roleWeight(role: TextRole): number {
  return TYPE_SCALE[role].weight;
}

/**
 * Text colour by importance. Additive displays add light and never subtract it,
 * so hierarchy is opacity against the background rather than darker greys —
 * a "dark grey" caption is simply a dimmer white here.
 */
export const TEXT_PRIMARY = { r: 1, g: 1, b: 1, a: 1 };
export const TEXT_SECONDARY = { r: 1, g: 1, b: 1, a: 0.72 };
export const TEXT_TERTIARY = { r: 1, g: 1, b: 1, a: 0.55 };
