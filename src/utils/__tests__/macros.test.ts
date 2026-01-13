/**
 * Macro Replacement Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { replaceMacros, MacroContext } from '@/utils/macros';

describe('replaceMacros', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should replace [TIMESTAMP] with current Unix timestamp', () => {
    const url = 'https://example.com/track?ts=[TIMESTAMP]';
    const result = replaceMacros(url);
    
    expect(result).toBe(`https://example.com/track?ts=${Date.now()}`);
  });

  it('should replace [CACHEBUSTING] with a random string', () => {
    const url = 'https://example.com/track?cb=[CACHEBUSTING]';
    const result = replaceMacros(url);
    
    expect(result).not.toContain('[CACHEBUSTING]');
    expect(result).toMatch(/https:\/\/example\.com\/track\?cb=[a-z0-9]+/);
  });

  it('should replace multiple macros in the same URL', () => {
    const url = 'https://example.com?ts=[TIMESTAMP]&cb=[CACHEBUSTING]';
    const result = replaceMacros(url);
    
    expect(result).not.toContain('[TIMESTAMP]');
    expect(result).not.toContain('[CACHEBUSTING]');
  });

  it('should replace [ASSETURI] with encoded asset URI', () => {
    const url = 'https://example.com/track?asset=[ASSETURI]';
    const context: MacroContext = { assetUri: 'https://cdn.example.com/video.mp4' };
    const result = replaceMacros(url, context);
    
    expect(result).toBe(
      'https://example.com/track?asset=https%3A%2F%2Fcdn.example.com%2Fvideo.mp4'
    );
  });

  it('should replace [CONTENTPLAYHEAD] with HH:MM:SS.mmm format', () => {
    const url = 'https://example.com/track?pos=[CONTENTPLAYHEAD]';
    const context: MacroContext = { contentPlayhead: 65.5 }; // 1:05.500
    const result = replaceMacros(url, context);
    
    expect(result).toBe('https://example.com/track?pos=00:01:05.500');
  });

  it('should replace [ADPLAYHEAD] with HH:MM:SS.mmm format', () => {
    const url = 'https://example.com/track?pos=[ADPLAYHEAD]';
    const context: MacroContext = { adPlayhead: 3661.123 }; // 1:01:01.123
    const result = replaceMacros(url, context);
    
    expect(result).toBe('https://example.com/track?pos=01:01:01.123');
  });

  it('should replace [ERRORCODE] with error code number', () => {
    const url = 'https://example.com/error?code=[ERRORCODE]';
    const context: MacroContext = { errorCode: 402 };
    const result = replaceMacros(url, context);
    
    expect(result).toBe('https://example.com/error?code=402');
  });

  it('should replace [BREAKPOSITION] with break position', () => {
    const url = 'https://example.com/track?break=[BREAKPOSITION]';
    const context: MacroContext = { breakPosition: 2 };
    const result = replaceMacros(url, context);
    
    expect(result).toBe('https://example.com/track?break=2');
  });

  it('should replace [ADTYPE] with ad type string', () => {
    const url = 'https://example.com/track?type=[ADTYPE]';
    const context: MacroContext = { adType: 'linear' };
    const result = replaceMacros(url, context);
    
    expect(result).toBe('https://example.com/track?type=linear');
  });

  it('should not replace macros without context values', () => {
    const url = 'https://example.com/track?asset=[ASSETURI]&error=[ERRORCODE]';
    const result = replaceMacros(url);
    
    // Without context, these should remain as-is
    expect(result).toContain('[ASSETURI]');
    expect(result).toContain('[ERRORCODE]');
  });

  it('should handle URLs with no macros', () => {
    const url = 'https://example.com/simple/track';
    const result = replaceMacros(url);
    
    expect(result).toBe(url);
  });

  it('should handle empty URL', () => {
    const result = replaceMacros('');
    expect(result).toBe('');
  });

  it('should format playhead correctly for zero seconds', () => {
    const url = 'https://example.com?pos=[ADPLAYHEAD]';
    const context: MacroContext = { adPlayhead: 0 };
    const result = replaceMacros(url, context);
    
    expect(result).toBe('https://example.com?pos=00:00:00.000');
  });
});
