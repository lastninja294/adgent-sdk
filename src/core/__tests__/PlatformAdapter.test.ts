/**
 * PlatformAdapter Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformAdapter, getPlatformAdapter } from '@/core/PlatformAdapter';
import { Platform, KeyAction } from '@/types/platform';

describe('PlatformAdapter', () => {
  const originalNavigator = global.navigator;
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original objects
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true
    });
  });

  describe('Platform Detection', () => {
    it('should detect Tizen platform from userAgent', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0)' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.Tizen);
    });

    it('should detect WebOS platform from userAgent', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV)' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.WebOS);
    });

    it('should detect Vidaa platform from userAgent', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Linux; Vidaa 4.0)' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.Vidaa);
    });

    it('should detect WhaleOS platform from userAgent', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Linux; WhaleTV)' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.WhaleOS);
    });

    it('should fallback to Generic platform', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.Generic);
    });

    it('should detect Tizen from window.tizen object', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });
      Object.defineProperty(global, 'window', {
        value: { tizen: {} },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.Tizen);
    });

    it('should detect WebOS from window.webOS object', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });
      Object.defineProperty(global, 'window', {
        value: { webOS: {} },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.platform).toBe(Platform.WebOS);
    });
  });

  describe('Key Code Normalization', () => {
    it('should normalize Enter key for Generic platform', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.normalizeKeyCode(13)).toBe(KeyAction.Enter);
    });

    it('should normalize Back key (Escape) for Generic platform', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.normalizeKeyCode(27)).toBe(KeyAction.Back);
    });

    it('should normalize arrow keys for Generic platform', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.normalizeKeyCode(37)).toBe(KeyAction.Left);
      expect(adapter.normalizeKeyCode(38)).toBe(KeyAction.Up);
      expect(adapter.normalizeKeyCode(39)).toBe(KeyAction.Right);
      expect(adapter.normalizeKeyCode(40)).toBe(KeyAction.Down);
    });

    it('should normalize Tizen-specific Back key (10009)', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Tizen 5.0' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.normalizeKeyCode(10009)).toBe(KeyAction.Back);
    });

    it('should normalize WebOS-specific Back key (461)', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Web0S' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.normalizeKeyCode(461)).toBe(KeyAction.Back);
    });

    it('should return null for unknown key codes', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.normalizeKeyCode(999)).toBeNull();
    });
  });

  describe('Reverse Key Mapping', () => {
    it('should get key codes for an action', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      const backKeys = adapter.getKeyCodesForAction(KeyAction.Back);
      
      expect(backKeys).toContain(27); // Escape
      expect(backKeys).toContain(8);  // Backspace
    });

    it('should return empty array for unmapped actions', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      // Generic platform doesn't have Info key mapped
      const infoKeys = adapter.getKeyCodesForAction(KeyAction.Info);
      
      expect(infoKeys).toEqual([]);
    });
  });

  describe('Platform Capabilities', () => {
    it('should detect sendBeacon capability', () => {
      Object.defineProperty(global, 'navigator', {
        value: { 
          userAgent: 'Generic Browser',
          sendBeacon: vi.fn()
        },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.capabilities.sendBeacon).toBe(true);
    });

    it('should detect missing sendBeacon', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.capabilities.sendBeacon).toBe(false);
    });

    it('should set mutedAutoplayRequired to true', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      expect(adapter.capabilities.mutedAutoplayRequired).toBe(true);
    });
  });

  describe('Video Attributes', () => {
    it('should return base video attributes', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Generic Browser' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      const attrs = adapter.getVideoAttributes();
      
      expect(attrs.muted).toBe(true);
      expect(attrs.playsinline).toBe(true);
      expect(attrs.autoplay).toBe(true);
      expect(attrs['webkit-playsinline']).toBe(true);
    });

    it('should include Tizen-specific attributes', () => {
      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'Tizen 5.0' },
        writable: true
      });

      const adapter = new PlatformAdapter();
      const attrs = adapter.getVideoAttributes();
      
      expect(attrs['data-samsung-immersive']).toBe('true');
    });
  });

  describe('Singleton', () => {
    it('should return same instance from getPlatformAdapter', () => {
      // Note: This test may be flaky due to module caching
      // In real usage, the singleton pattern works correctly
      const adapter1 = getPlatformAdapter();
      const adapter2 = getPlatformAdapter();
      
      expect(adapter1).toBe(adapter2);
    });
  });
});
