/**
 * Self-hosted fonts (no external requests — the sandbox cannot reach Google Fonts and the demo is
 * also published as a single file). Only the latin subsets and the weights the UI actually uses:
 *   display  Cormorant Garamond 500 / 600 / 500 italic — names, wordmark, small caps, prose
 *   ui       IBM Plex Sans 400 / 500
 *   data     IBM Plex Mono 400 / 500 — tabular numerals
 * The @font-face rules live in fonts.css (woff2 only, from @fontsource's files). Imported once, by App.
 */
import './fonts.css';
