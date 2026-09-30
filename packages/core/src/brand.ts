/** Product name shown in the UI. JEWL by W3J LLC, forked from Rakazo (Apache-2.0). */
export const PRODUCT_NAME = "JEWL";
export const PRODUCT_MAKER = "W3J LLC";
export const PRODUCT_MAKER_URL = "https://w3jdev.com/";

/**
 * JEWL mark geometry on a 64-unit square: a cut gem (three crown facets over a pavilion) whose
 * pavilion carries two eye facets. Fill and stroke both paths at `strokeWidth` with round joins;
 * the pavilion uses the even-odd rule so the eyes stay open. Keep
 * packages/ui-tokens/assets/jewl-mark.svg, the app icon source, in sync.
 */
export const JEWL_MARK = {
  viewBox: "0 0 64 64",
  strokeWidth: 2,
  crown: "M20 8H24.7L18.7 22.5H7.3Z M27.3 8H36.7L42.7 22.5H21.3Z M39.3 8H44L56.7 22.5H45.3Z",
  pavilion:
    "M7.2 25.5H56.8L32 58Z M26.5 29A4 4 0 0 1 30.5 33V38A4 4 0 0 1 22.5 38V33A4 4 0 0 1 26.5 29Z M37.5 29A4 4 0 0 1 41.5 33V38A4 4 0 0 1 33.5 38V33A4 4 0 0 1 37.5 29Z",
} as const;
