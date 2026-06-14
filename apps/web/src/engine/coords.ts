/** Pixel coordinate pair within the canvas. */
export interface PixelPoint {
  px: number;
  py: number;
}

/**
 * Convert a normalized [0, 1] scene coordinate into a pixel coordinate for a
 * canvas of the given width/height. This is the single source of truth for the
 * protocol's normalized-coordinate convention (`AvatarState.x`/`.y`).
 *
 * Inputs are clamped to [0, 1] so out-of-range values stay on-canvas.
 */
export function normalizedToPixel(
  x: number,
  y: number,
  width: number,
  height: number,
): PixelPoint {
  return {
    px: clamp01(x) * width,
    py: clamp01(y) * height,
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
