/**
 * Self-hosted fonts (no external requests — the sandbox cannot reach Google Fonts and the demo is
 * also published as a single file). Only the latin subsets and the weights the UI actually uses:
 *   display  Cormorant Garamond 500 / 600 / 500 italic — names, wordmark, small caps, prose
 *   ui       IBM Plex Sans 400 / 500
 *   data     IBM Plex Mono 400 / 500 — tabular numerals
 * Imported once, by App.
 */
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
