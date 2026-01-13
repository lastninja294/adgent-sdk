/**
 * AdTracker Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdTracker } from '@/core/AdTracker';
import { TrackingEvent } from '@/types/vast';

// Mock PlatformAdapter
vi.mock('@/core/PlatformAdapter', () => ({
  getPlatformAdapter: () => ({
    platform: 'generic',
    capabilities: {
      sendBeacon: true,
      fetchKeepalive: true,
      mutedAutoplayRequired: true,
      fullscreen: true,
      hardwareDecodeInfo: false
    }
  })
}));

describe('AdTracker', () => {
  let mockSendBeacon: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock sendBeacon
    mockSendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(global.navigator, 'sendBeacon', {
      value: mockSendBeacon,
      writable: true,
      configurable: true
    });

    // Mock fetch
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as typeof fetch;

    // Mock console.log for debug output
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Event Tracking', () => {
    it('should fire pixel for tracked event', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start');
      
      expect(mockSendBeacon).toHaveBeenCalledWith('https://example.com/start');
    });

    it('should fire multiple pixels for same event type', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start1' },
        { event: 'start', url: 'https://example.com/start2' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start');
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(2);
      expect(mockSendBeacon).toHaveBeenCalledWith('https://example.com/start1');
      expect(mockSendBeacon).toHaveBeenCalledWith('https://example.com/start2');
    });

    it('should deduplicate events when once=true', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start', true);
      tracker.track('start', true);
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(1);
    });

    it('should allow duplicate events when once=false', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start', false);
      tracker.track('start', false);
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(2);
    });

    it('should track different event types independently', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' },
        { event: 'complete', url: 'https://example.com/complete' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start');
      tracker.track('complete');
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(2);
    });

    it('should not fire for unknown event types', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('midpoint'); // Not in events
      
      expect(mockSendBeacon).not.toHaveBeenCalled();
    });
  });

  describe('Macro Replacement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should replace macros in tracking URLs', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/track?ts=[TIMESTAMP]' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start');
      
      expect(mockSendBeacon).toHaveBeenCalledWith(
        expect.stringContaining('ts=')
      );
      expect(mockSendBeacon).not.toHaveBeenCalledWith(
        expect.stringContaining('[TIMESTAMP]')
      );
    });

    it('should use updated macro context', () => {
      const events: TrackingEvent[] = [
        { event: 'progress', url: 'https://example.com/track?pos=[ADPLAYHEAD]' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.updateMacroContext({ adPlayhead: 15.5 });
      tracker.track('progress', false);
      
      expect(mockSendBeacon).toHaveBeenCalledWith(
        'https://example.com/track?pos=00:00:15.500'
      );
    });
  });

  describe('Impression Tracking', () => {
    it('should fire impression pixels', () => {
      const tracker = new AdTracker([]);
      const impressionUrls = [
        'https://example.com/imp1',
        'https://example.com/imp2'
      ];
      
      tracker.fireImpressions(impressionUrls);
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(2);
      expect(mockSendBeacon).toHaveBeenCalledWith('https://example.com/imp1');
      expect(mockSendBeacon).toHaveBeenCalledWith('https://example.com/imp2');
    });
  });

  describe('Error Tracking', () => {
    it('should fire error pixels with error code', () => {
      const tracker = new AdTracker([]);
      const errorUrls = ['https://example.com/error?code=[ERRORCODE]'];
      
      tracker.fireError(errorUrls, 402);
      
      expect(mockSendBeacon).toHaveBeenCalledWith(
        'https://example.com/error?code=402'
      );
    });
  });

  describe('Reset', () => {
    it('should allow re-firing events after reset', () => {
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' }
      ];
      
      const tracker = new AdTracker(events);
      tracker.track('start');
      tracker.track('start'); // Should be deduplicated
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(1);
      
      tracker.reset();
      tracker.track('start'); // Should fire again
      
      expect(mockSendBeacon).toHaveBeenCalledTimes(2);
    });
  });

  describe('Fallback Mechanisms', () => {
    it('should fallback to fetch when sendBeacon fails', () => {
      mockSendBeacon.mockReturnValue(false);
      
      const tracker = new AdTracker([]);
      tracker.firePixel('https://example.com/track');
      
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/track', {
        method: 'GET',
        keepalive: true,
        mode: 'no-cors',
        credentials: 'omit'
      });
    });
  });

  describe('Debug Mode', () => {
    it('should log when debug is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const events: TrackingEvent[] = [
        { event: 'start', url: 'https://example.com/start' }
      ];
      
      const tracker = new AdTracker(events, { debug: true });
      tracker.track('start');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AdTracker]')
      );
    });
  });
});
