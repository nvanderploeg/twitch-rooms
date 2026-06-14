import { describe, expect, it } from 'vitest';
import { normalizedToPixel } from './coords.js';

describe('normalizedToPixel', () => {
  it('scales normalized coordinates to canvas pixels', () => {
    expect(normalizedToPixel(0.5, 0.25, 800, 600)).toEqual({ px: 400, py: 150 });
  });

  it('maps the origin and far corner exactly', () => {
    expect(normalizedToPixel(0, 0, 1280, 720)).toEqual({ px: 0, py: 0 });
    expect(normalizedToPixel(1, 1, 1280, 720)).toEqual({ px: 1280, py: 720 });
  });

  it('clamps out-of-range and NaN inputs to stay on-canvas', () => {
    expect(normalizedToPixel(-0.5, 2, 400, 400)).toEqual({ px: 0, py: 400 });
    expect(normalizedToPixel(Number.NaN, 0.5, 400, 400)).toEqual({ px: 0, py: 200 });
  });
});
