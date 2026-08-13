/**
 * VPAIDAdUnit Unit Tests
 *
 * No real third-party JS is ever executed here — tests inject a bare
 * iframe via options.createIframe and manually attach getVPAIDAd to
 * simulate the creative's script having loaded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VPAIDAdUnit } from '@/core/VPAIDAdUnit';
import { getPlatformAdapter, resetPlatformAdapter } from '@/core/PlatformAdapter';
import { IVPAIDAdUnit } from '@/types/vpaid';
import { Linear, MediaFile } from '@/types/vast';

const MEDIA_FILE: MediaFile = {
  url: 'https://example.com/vpaid.js',
  delivery: 'progressive',
  type: 'application/javascript',
  width: 640,
  height: 360,
  apiFramework: 'VPAID'
};

const LINEAR: Linear = {
  duration: 30,
  mediaFiles: [MEDIA_FILE],
  trackingEvents: [],
  adParameters: '{"key":"value"}'
};

function createMockAdUnit() {
  const subs = new Map<string, (...args: unknown[]) => void>();

  const unit: IVPAIDAdUnit = {
    handshakeVersion: vi.fn().mockReturnValue('2.0'),
    initAd: vi.fn(),
    startAd: vi.fn(),
    stopAd: vi.fn(),
    resizeAd: vi.fn(),
    pauseAd: vi.fn(),
    resumeAd: vi.fn(),
    skipAd: vi.fn(),
    setAdVolume: vi.fn(),
    getAdVolume: vi.fn().mockReturnValue(1),
    getAdSkippableState: vi.fn().mockReturnValue(false),
    getAdRemainingTime: vi.fn().mockReturnValue(0),
    getAdDuration: vi.fn().mockReturnValue(30),
    subscribe: vi.fn((cb: (...args: unknown[]) => void, event: string) => {
      subs.set(event, cb);
    }),
    unsubscribe: vi.fn((_cb: (...args: unknown[]) => void, event: string) => {
      subs.delete(event);
    })
  };

  return {
    unit,
    subs,
    trigger: (event: string, ...args: unknown[]) => subs.get(event)?.(...args)
  };
}

function createStubIframe(): HTMLIFrameElement {
  return document.createElement('iframe');
}

describe('VPAIDAdUnit', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    resetPlatformAdapter();
  });

  /** Drives a mock ad unit through handshake + AdLoaded and returns it, loaded */
  async function loadWithMock() {
    const { unit: mockAdUnit, trigger, subs } = createMockAdUnit();
    const iframe = createStubIframe();

    const vpaidUnit = new VPAIDAdUnit(
      container,
      MEDIA_FILE,
      LINEAR,
      getPlatformAdapter(),
      { createIframe: () => iframe, timeout: 1000 }
    );

    const loadPromise = vpaidUnit.load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (iframe.contentWindow as any).getVPAIDAd = () => mockAdUnit;

    await vi.advanceTimersByTimeAsync(60);
    trigger('AdLoaded');
    await loadPromise;

    return { vpaidUnit, mockAdUnit, trigger, subs, iframe };
  }

  describe('handshake', () => {
    it('handshakes, subscribes to events, and calls initAd with the right args', async () => {
      const { mockAdUnit } = await loadWithMock();

      expect(mockAdUnit.handshakeVersion).toHaveBeenCalledWith('2.0');
      expect(mockAdUnit.subscribe).toHaveBeenCalled();
      expect(mockAdUnit.initAd).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        'normal',
        expect.any(Number),
        { AdParameters: LINEAR.adParameters },
        expect.objectContaining({ videoSlotCanAutoPlay: true })
      );
      expect(mockAdUnit.startAd).toHaveBeenCalled();
    });

    it('only calls startAd() once even if the creative re-fires AdLoaded', async () => {
      const { mockAdUnit, trigger } = await loadWithMock();

      trigger('AdLoaded');
      trigger('AdLoaded');

      expect(mockAdUnit.startAd).toHaveBeenCalledTimes(1);
    });

    it('rejects when the creative reports an unsupported handshake version', async () => {
      const { unit: mockAdUnit } = createMockAdUnit();
      mockAdUnit.handshakeVersion = vi.fn().mockReturnValue('1.0');
      const iframe = createStubIframe();

      const vpaidUnit = new VPAIDAdUnit(
        container,
        MEDIA_FILE,
        LINEAR,
        getPlatformAdapter(),
        { createIframe: () => iframe, timeout: 1000 }
      );

      const loadPromise = vpaidUnit.load();
      const assertion = expect(loadPromise).rejects.toThrow(/Unsupported VPAID version/);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (iframe.contentWindow as any).getVPAIDAd = () => mockAdUnit;

      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    });

    it('rejects on timeout when getVPAIDAd never appears', async () => {
      const iframe = createStubIframe();
      const vpaidUnit = new VPAIDAdUnit(
        container,
        MEDIA_FILE,
        LINEAR,
        getPlatformAdapter(),
        { createIframe: () => iframe, timeout: 500 }
      );

      const loadPromise = vpaidUnit.load();
      const assertion = expect(loadPromise).rejects.toThrow(/timed out/);

      await vi.advanceTimersByTimeAsync(600);
      await assertion;

      // load() rejecting doesn't itself tear down the iframe — cleanup on
      // failure is the caller's responsibility (see AdPlayer.initVPAID's
      // catch block, which calls destroy()). Confirm that contract here.
      expect(container.querySelector('iframe')).not.toBeNull();
      vpaidUnit.destroy();
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('rejects on AdError fired before AdLoaded, without emitting it to subscribers', async () => {
      const { unit: mockAdUnit, trigger } = createMockAdUnit();
      const iframe = createStubIframe();

      const vpaidUnit = new VPAIDAdUnit(
        container,
        MEDIA_FILE,
        LINEAR,
        getPlatformAdapter(),
        { createIframe: () => iframe, timeout: 1000 }
      );

      const onError = vi.fn();
      vpaidUnit.on('AdError', onError);

      const loadPromise = vpaidUnit.load();
      const assertion = expect(loadPromise).rejects.toThrow('creative failed to load asset');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (iframe.contentWindow as any).getVPAIDAd = () => mockAdUnit;

      await vi.advanceTimersByTimeAsync(60);
      trigger('AdError', 'creative failed to load asset');

      await assertion;

      // Pre-AdLoaded, an AdError means the load attempt itself failed —
      // the caller (AdPlayer.initVPAID) decides whether to fall back, so
      // this must not also surface as a subscriber-facing error event.
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('event forwarding', () => {
    it('forwards events to subscribers after load() has resolved', async () => {
      const { vpaidUnit, trigger } = await loadWithMock();

      const onQuartile = vi.fn();
      vpaidUnit.on('AdVideoFirstQuartile', onQuartile);
      trigger('AdVideoFirstQuartile');

      expect(onQuartile).toHaveBeenCalled();
    });

    it('still emits AdError to subscribers for runtime errors after load resolved', async () => {
      const { vpaidUnit, trigger } = await loadWithMock();

      const onError = vi.fn();
      vpaidUnit.on('AdError', onError);
      trigger('AdError', 'runtime failure');

      expect(onError).toHaveBeenCalledWith('runtime failure');
    });

    it('off() stops delivering events', async () => {
      const { vpaidUnit, trigger } = await loadWithMock();

      const onComplete = vi.fn();
      vpaidUnit.on('AdVideoComplete', onComplete);
      vpaidUnit.off('AdVideoComplete', onComplete);
      trigger('AdVideoComplete');

      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('control method delegation', () => {
    it('delegates pauseAd/resumeAd/stopAd/skipAd/setAdVolume/resize to the raw ad unit', async () => {
      const { vpaidUnit, mockAdUnit } = await loadWithMock();

      vpaidUnit.pauseAd();
      vpaidUnit.resumeAd();
      vpaidUnit.skipAd();
      vpaidUnit.setAdVolume(0.5);
      vpaidUnit.resize(800, 600);

      expect(mockAdUnit.pauseAd).toHaveBeenCalled();
      expect(mockAdUnit.resumeAd).toHaveBeenCalled();
      expect(mockAdUnit.skipAd).toHaveBeenCalled();
      expect(mockAdUnit.setAdVolume).toHaveBeenCalledWith(0.5);
      expect(mockAdUnit.resizeAd).toHaveBeenCalledWith(800, 600, 'normal');
    });

    it('reads duration/remaining-time/skippable-state through to the raw ad unit', async () => {
      const { vpaidUnit, mockAdUnit } = await loadWithMock();
      mockAdUnit.getAdDuration = vi.fn().mockReturnValue(15);
      mockAdUnit.getAdRemainingTime = vi.fn().mockReturnValue(5);
      mockAdUnit.getAdSkippableState = vi.fn().mockReturnValue(true);

      expect(vpaidUnit.getDuration()).toBe(15);
      expect(vpaidUnit.getRemainingTime()).toBe(5);
      expect(vpaidUnit.getSkippableState()).toBe(true);
    });

    it('control methods are safe no-ops before load() completes', () => {
      const iframe = createStubIframe();
      const vpaidUnit = new VPAIDAdUnit(
        container,
        MEDIA_FILE,
        LINEAR,
        getPlatformAdapter(),
        { createIframe: () => iframe, timeout: 1000 }
      );

      expect(() => {
        vpaidUnit.pauseAd();
        vpaidUnit.resumeAd();
        vpaidUnit.skipAd();
        vpaidUnit.setAdVolume(1);
        vpaidUnit.resize(100, 100);
      }).not.toThrow();

      expect(vpaidUnit.getDuration()).toBe(0);
      expect(vpaidUnit.getRemainingTime()).toBe(0);
      expect(vpaidUnit.getSkippableState()).toBe(false);

      vpaidUnit.destroy();
    });
  });

  describe('destroy', () => {
    it('unsubscribes raw listeners before calling stopAd, then removes the iframe', async () => {
      const { vpaidUnit, mockAdUnit, subs } = await loadWithMock();
      expect(subs.size).toBeGreaterThan(0);

      const order: string[] = [];
      mockAdUnit.unsubscribe = vi.fn(() => order.push('unsubscribe'));
      mockAdUnit.stopAd = vi.fn(() => order.push('stopAd'));

      vpaidUnit.destroy();

      expect(order[0]).toBe('unsubscribe');
      expect(order[order.length - 1]).toBe('stopAd');
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('is idempotent across multiple calls', async () => {
      const { vpaidUnit, mockAdUnit } = await loadWithMock();

      vpaidUnit.destroy();
      expect(() => vpaidUnit.destroy()).not.toThrow();
      expect(mockAdUnit.stopAd).toHaveBeenCalledTimes(1);
    });

    it('rejects a pending load() when destroyed mid-handshake, without throwing', async () => {
      const iframe = createStubIframe();
      const vpaidUnit = new VPAIDAdUnit(
        container,
        MEDIA_FILE,
        LINEAR,
        getPlatformAdapter(),
        { createIframe: () => iframe, timeout: 5000 }
      );

      const loadPromise = vpaidUnit.load();
      const assertion = expect(loadPromise).rejects.toThrow(/destroyed/);

      expect(() => vpaidUnit.destroy()).not.toThrow();

      await assertion;
      expect(container.querySelector('iframe')).toBeNull();
    });
  });

  describe('default iframe', () => {
    it('creates a sandboxed srcdoc iframe pointing at the media file', () => {
      const vpaidUnit = new VPAIDAdUnit(
        container,
        MEDIA_FILE,
        LINEAR,
        getPlatformAdapter(),
        { timeout: 1000 }
      );

      const loadPromise = vpaidUnit.load();
      loadPromise.catch(() => {});

      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups');
      expect(iframe?.srcdoc).toContain(MEDIA_FILE.url);
      expect(iframe?.srcdoc).toContain('<script src=');
      expect(iframe?.srcdoc).toContain('id="vpaid-slot"');
      expect(iframe?.srcdoc).toContain('id="vpaid-video"');

      vpaidUnit.destroy();
    });

    it('escapes the media file URL to avoid HTML injection via VAST content', () => {
      const maliciousMediaFile: MediaFile = {
        ...MEDIA_FILE,
        url: 'https://example.com/x.js"><script>alert(1)</script>'
      };

      const vpaidUnit = new VPAIDAdUnit(
        container,
        maliciousMediaFile,
        LINEAR,
        getPlatformAdapter(),
        { timeout: 1000 }
      );

      const loadPromise = vpaidUnit.load();
      loadPromise.catch(() => {});

      const iframe = container.querySelector('iframe');
      expect(iframe?.srcdoc).not.toContain('"><script>alert(1)</script>');

      vpaidUnit.destroy();
    });
  });
});
