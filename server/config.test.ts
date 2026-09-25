import { describe, expect, it } from 'vitest';
import { isValidNamePattern } from './config.js';

describe('isValidNamePattern', () => {
  it('validates patterns containing {nr}', () => {
    expect(isValidNamePattern('{name} - Teil {nr} von {gesamt}')).toBe(true);
    expect(isValidNamePattern('{name}_{nr}')).toBe(true);
    expect(isValidNamePattern('{name}_{start}_{ende}_{nr}')).toBe(true);
  });

  it('rejects patterns missing {nr}', () => {
    expect(isValidNamePattern('{name} - Teil von {gesamt}')).toBe(false);
    expect(isValidNamePattern('video')).toBe(false);
  });

  it('rejects patterns with unknown placeholders', () => {
    expect(isValidNamePattern('{name}_{nr}_{unbekannt}')).toBe(false);
  });
});
