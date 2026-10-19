import { describe, expect, it } from 'vitest';
import { pickDefaultHeight } from './quality.js';

describe('pickDefaultHeight', () => {
  it('picks the preferred height when available', () => {
    expect(pickDefaultHeight([2160, 1080, 720], 1080)).toBe(1080);
  });

  it('falls back to the best height below the preference', () => {
    expect(pickDefaultHeight([2160, 1440, 720, 360], 1080)).toBe(720);
  });

  it('uses the lowest height when everything is above the preference', () => {
    expect(pickDefaultHeight([2160, 1440], 1080)).toBe(1440);
  });

  it('handles unsorted input and empty lists', () => {
    expect(pickDefaultHeight([360, 1080, 720], 800)).toBe(720);
    expect(pickDefaultHeight([], 1080)).toBeUndefined();
  });
});
