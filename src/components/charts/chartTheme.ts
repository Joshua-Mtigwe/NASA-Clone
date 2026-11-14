/**
 * Chart colours for the dark navy console. Validated with the dataviz skill's
 * validate_palette.js against the card surface #0e1a30 (dark mode): lightness band,
 * chroma floor, CVD separation (ΔE 8.6 deutan), normal-vision floor and 3:1
 * contrast all PASS. The app ships one dark theme only.
 */
export const chartColors = {
  /** Primary series (single-series charts). */
  series: '#16a2ba',
  /** Second series, only when two series share a chart. */
  seriesAlt: '#9b7cf0',
  /** Personal reference band: neutral, never a status colour. */
  referenceFill: 'rgba(164, 179, 204, 0.14)',
  referenceStroke: '#5a6d8f',
  /** Recessive hairline grid, one step off the surface. */
  grid: '#1c2e4f',
  axis: '#a4b3cc',
  surface: '#0e1a30',
} as const;

/**
 * Categorical order for up to five participants (fixed order, never cycled). From the
 * dataviz reference dark palette, yellow swapped for violet (yellow reads as the review
 * status). Validated on #0e1a30: all six checks PASS (worst CVD ΔE 9.4).
 */
export const participantSeries = ['#3987e5', '#d95926', '#199e70', '#9085e9', '#d55181'] as const;

export const axisTick = { fill: chartColors.axis, fontSize: 12 } as const;
