// Binder — domain accent colours, derived not hardcoded.
//
// BINDER.md § Data schema: "Domain = string; sourced from card data, never
// hardcoded." So there is no domain->colour table here.
//
// Hashing each domain to a hue independently looks principled and reads badly:
// with only a handful of domains, an unbiased hash happily puts four of them
// within a few degrees of each other and the wall turns into one colour. The
// palette is instead built from the domains actually present in the card
// source, spaced evenly around the wheel — still data-driven, but guaranteed
// maximally distinct. `domainColor` remains as the fallback for a domain that
// appears after the palette was built.

export interface Rgb { r: number; g: number; b: number }

const NEUTRAL: Rgb = { r: 0.62, g: 0.62, b: 0.66 };
const SATURATION = 0.58;
const LIGHTNESS = 0.54;
/** Nudges the first hue off pure red, which reads as an error state. */
const HUE_OFFSET = 28;

export type DomainPalette = Map<string, Rgb>;

function key(domain: string): string {
  return domain.trim().toLowerCase();
}

/** FNV-1a, so an unknown domain still gets a stable colour. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/**
 * Even hue spacing over the distinct domains present. Sorted so the mapping is
 * stable across runs — a domain must not change colour because a card was
 * scanned in a different order.
 */
export function buildDomainPalette(domainLists: readonly (readonly string[])[]): DomainPalette {
  const distinct: string[] = [];
  for (const domains of domainLists) {
    for (const domain of domains) {
      const k = key(domain);
      if (k !== '' && distinct.indexOf(k) === -1) distinct.push(k);
    }
  }
  distinct.sort();

  const palette: DomainPalette = new Map();
  distinct.forEach((k, i) => {
    palette.set(k, hslToRgb(HUE_OFFSET + (i * 360) / distinct.length, SATURATION, LIGHTNESS));
  });
  return palette;
}

/**
 * Accent for a card. A card may carry several domains ("Fury" + "Order"); the
 * plate takes the FIRST, which the data orders as the primary one. The full
 * list is shown in the focus slot rather than encoded into one colour.
 *
 * Note that a colourless card has the literal domain "Colorless", so it gets a
 * palette entry like any other. NEUTRAL is only for a genuinely empty list.
 */
export function domainColor(domains: readonly string[], palette?: DomainPalette): Rgb {
  const primary = domains.length > 0 ? domains[0] : '';
  if (primary.trim() === '') return NEUTRAL;
  const k = key(primary);
  if (palette !== undefined) {
    const found = palette.get(k);
    if (found !== undefined) return found;
  }
  return hslToRgb(hash(k) % 360, SATURATION, LIGHTNESS);
}
