/**
 * VPAID Ad Unit
 * Loads and drives a VPAID 2.0 JavaScript creative inside a sandboxed
 * "friendly iframe", translating its lifecycle into a simple on/off event
 * surface for AdPlayer to consume. Opt-in, web-only companion to the native
 * <video> playback path — see AdPlayer.initVPAID().
 */

import {
  IVPAIDAdUnit,
  VPAIDPlayerEventName,
  VPAIDAdUnitOptions
} from '@/types/vpaid';
import { Linear, MediaFile } from '@/types/vast';
import { PlatformAdapter } from '@/core/PlatformAdapter';

const HANDSHAKE_VERSION = '2.0';
const POLL_INTERVAL_MS = 50;

/**
 * Events this SDK subscribes to on the raw ad unit. See VPAIDPlayerEventName
 * for the events intentionally NOT subscribed to in v1.
 */
const VPAID_EVENTS: VPAIDPlayerEventName[] = [
  'AdLoaded',
  'AdStarted',
  'AdImpression',
  'AdVideoStart',
  'AdVideoFirstQuartile',
  'AdVideoMidpoint',
  'AdVideoThirdQuartile',
  'AdVideoComplete',
  'AdPaused',
  'AdPlaying',
  'AdSkipped',
  'AdSkippableStateChange',
  'AdClickThru',
  'AdRemainingTimeChange',
  'AdVolumeChange',
  'AdError',
  'AdStopped'
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

export class VPAIDAdUnit {
  private readonly container: HTMLElement;
  private readonly mediaFile: MediaFile;
  private readonly linear: Linear;
  private readonly platform: PlatformAdapter;
  private readonly options: Required<Omit<VPAIDAdUnitOptions, 'createIframe'>> &
    Pick<VPAIDAdUnitOptions, 'createIframe'>;

  private iframe: HTMLIFrameElement | null = null;
  private adUnit: IVPAIDAdUnit | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Guards against a creative firing 'AdLoaded' more than once */
  private startAdCalled = false;

  private readonly listeners = new Map<VPAIDPlayerEventName, Set<Listener>>();
  private readonly rawSubscriptions: Array<{
    event: VPAIDPlayerEventName;
    callback: Listener;
  }> = [];

  private settleLoad: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(
    container: HTMLElement,
    mediaFile: MediaFile,
    linear: Linear,
    platform: PlatformAdapter,
    options: VPAIDAdUnitOptions = {}
  ) {
    this.container = container;
    this.mediaFile = mediaFile;
    this.linear = linear;
    this.platform = platform;
    this.options = {
      timeout: options.timeout ?? 8000,
      viewMode: options.viewMode ?? 'normal',
      desiredBitrate: options.desiredBitrate ?? 2500,
      debug: options.debug ?? false,
      createIframe: options.createIframe
    };
  }

  /** Subscribe to a mapped VPAID event */
  on(event: VPAIDPlayerEventName, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /** Unsubscribe from a mapped VPAID event */
  off(event: VPAIDPlayerEventName, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: VPAIDPlayerEventName, ...args: unknown[]): void {
    // Defense-in-depth: some real-world creatives implement unsubscribe()
    // with a non-spec-compliant signature (e.g. unsubscribe(eventName) with
    // no callback param), silently defeating the raw unsubscribe calls in
    // destroy(). Guarding here ensures a stray event from an already-
    // destroyed ad unit (e.g. AdStopped from within our own stopAd() call
    // during teardown) can never reach AdPlayer regardless.
    if (this.destroyed) return;

    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        this.log(`Listener error for ${event}: ${error}`);
      }
    });
  }

  /**
   * Load the VPAID creative: create the friendly iframe, wait for the
   * getVPAIDAd() factory, handshake, subscribe to events, and initAd().
   * Resolves once AdLoaded is observed and startAd() has been called;
   * rejects on timeout, version mismatch, or a creative error/throw.
   */
  async load(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error('VPAIDAdUnit has been destroyed'));
    }

    return new Promise<void>((resolve, reject) => {
      const settleResolve = () => {
        if (!this.settleLoad) return;
        this.settleLoad = null;
        this.clearTimers();
        resolve();
      };
      const settleReject = (error: Error) => {
        if (!this.settleLoad) return;
        this.settleLoad = null;
        this.clearTimers();
        reject(error);
      };

      this.settleLoad = { resolve: settleResolve, reject: settleReject };

      this.timeoutTimer = setTimeout(() => {
        settleReject(
          new Error(`VPAID handshake timed out after ${this.options.timeout}ms`)
        );
      }, this.options.timeout);

      let iframe: HTMLIFrameElement;
      try {
        iframe = this.options.createIframe
          ? this.options.createIframe()
          : this.createDefaultIframe();
      } catch (error) {
        settleReject(this.toError(error));
        return;
      }

      this.iframe = iframe;
      if (!iframe.parentElement) {
        this.container.appendChild(iframe);
      }

      this.pollTimer = setInterval(() => {
        if (!this.settleLoad) return;

        let factory: (() => IVPAIDAdUnit) | undefined;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          factory = (iframe.contentWindow as any)?.getVPAIDAd;
        } catch {
          // Cross-origin access denied (shouldn't happen for a same-origin
          // srcdoc iframe) — keep polling until timeout.
          return;
        }

        if (typeof factory !== 'function') return;

        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }

        let unit: IVPAIDAdUnit;
        try {
          unit = factory();
        } catch (error) {
          settleReject(this.toError(error));
          return;
        }

        this.handshakeAndInit(unit, settleResolve, settleReject);
      }, POLL_INTERVAL_MS);
    });
  }

  /**
   * Handshake, subscribe to events, and initAd() the ad unit. AdLoaded
   * triggers startAd() and resolves load(); AdError before AdLoaded
   * rejects it. Both continue to emit to subscribers after settling so
   * AdPlayer still hears runtime events/errors during playback.
   */
  private handshakeAndInit(
    unit: IVPAIDAdUnit,
    settleResolve: () => void,
    settleReject: (error: Error) => void
  ): void {
    // Wrapped as one block (rather than scattered try/catches) so any
    // synchronous throw here — including getSlots() finding no
    // contentDocument — reliably rejects load() instead of escaping as an
    // unhandled exception from inside the poll timer callback.
    try {
      const version = unit.handshakeVersion(HANDSHAKE_VERSION);
      if (typeof version !== 'string' || !version.startsWith('2.')) {
        settleReject(new Error(`Unsupported VPAID version: ${String(version)}`));
        return;
      }

      this.adUnit = unit;

      for (const eventName of VPAID_EVENTS) {
        const callback: Listener = (...args: unknown[]) => {
          if (eventName === 'AdLoaded') {
            // Some creatives (or wrapper chains) re-fire AdLoaded; the VPAID
            // contract is exactly one startAd() call.
            if (this.startAdCalled) return;
            this.startAdCalled = true;

            try {
              unit.startAd();
            } catch (error) {
              settleReject(this.toError(error));
              return;
            }
            this.emit('AdLoaded', ...args);
            settleResolve();
            return;
          }

          if (eventName === 'AdError') {
            const message = typeof args[0] === 'string' ? args[0] : 'VPAID ad error';
            // Pre-AdLoaded, an AdError just means the load attempt failed —
            // only reject load() and let the caller (AdPlayer.initVPAID)
            // decide whether to fall back, without surfacing a spurious
            // onError for an ad that may still play fine via fallback.
            // Once load() has already settled, this is a genuine runtime
            // error during playback and should be forwarded to subscribers.
            if (this.settleLoad) {
              settleReject(new Error(message));
            } else {
              this.emit('AdError', ...args);
            }
            return;
          }

          this.emit(eventName, ...args);
        };

        try {
          unit.subscribe(callback, eventName);
          this.rawSubscriptions.push({ event: eventName, callback });
        } catch (error) {
          this.log(`Failed to subscribe to ${eventName}: ${error}`);
        }
      }

      const { slot, videoSlot } = this.getSlots();
      const width = this.container.clientWidth || this.mediaFile.width || 640;
      const height = this.container.clientHeight || this.mediaFile.height || 360;

      unit.initAd(
        width,
        height,
        this.options.viewMode,
        this.options.desiredBitrate,
        { AdParameters: this.linear.adParameters },
        { slot, videoSlot, videoSlotCanAutoPlay: true }
      );
    } catch (error) {
      settleReject(this.toError(error));
    }
  }

  /**
   * Resolve the slot/videoSlot elements the ad unit renders into. Reads
   * them from the default bootstrap markup when present; creates minimal
   * fallback elements otherwise (e.g. for a test-injected bare iframe).
   */
  private getSlots(): { slot: HTMLElement; videoSlot: HTMLVideoElement } {
    const doc = this.iframe?.contentDocument;
    if (!doc) {
      throw new Error('VPAID iframe document not available');
    }

    let slot = doc.getElementById('vpaid-slot') as HTMLElement | null;
    if (!slot) {
      slot = doc.createElement('div');
      slot.id = 'vpaid-slot';
      (doc.body || doc.documentElement).appendChild(slot);
    }

    let videoSlot = doc.getElementById('vpaid-video') as HTMLVideoElement | null;
    if (!videoSlot) {
      videoSlot = doc.createElement('video');
      videoSlot.id = 'vpaid-video';
      slot.appendChild(videoSlot);
    }

    return { slot, videoSlot };
  }

  /**
   * Build the default friendly iframe: a sandboxed, same-document (srcdoc)
   * bootstrap page containing a slot div, a Nuclear-Mute <video> as
   * videoSlot, and a <script> tag pointing at the VPAID creative.
   *
   * sandbox="allow-scripts allow-same-origin allow-popups" is the standard
   * "friendly iframe" convention also used by IMA SDK — allow-same-origin is
   * required so the creative's script can drive the videoSlot element, and
   * allow-popups is required because many real-world creatives open the
   * click-through URL themselves via window.open() (reporting
   * AdClickThru with playerHandles: false) rather than delegating to the
   * player; without it that window.open() is silently blocked and clicking
   * the ad does nothing. Combined with allow-scripts, allow-same-origin is
   * not a real security boundary (the script could remove its own sandbox
   * attribute). This is an inherent trade-off of executing third-party
   * VPAID JavaScript, not a bug.
   */
  private createDefaultIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('title', 'Advertisement');
    iframe.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;border:0;';

    const videoAttrs = this.platform.getVideoAttributes();
    const videoAttrString = Object.entries(videoAttrs)
      .map(([key, value]) => {
        if (typeof value === 'boolean') return value ? key : '';
        return `${key}="${this.escapeAttr(String(value))}"`;
      })
      .filter(Boolean)
      .join(' ');

    const src = this.escapeAttr(this.mediaFile.url);

    // #vpaid-video is positioned absolute (rather than in normal flow) so it
    // never affects layout of whatever the creative appends into #vpaid-slot
    // alongside it. Many real-world creatives ignore the provided videoSlot
    // and build their own <video> + container instead (permitted by the
    // VPAID 2.0 spec); if this placeholder were left in normal flow, its
    // own 100%-height box would push that sibling content a full slot-height
    // down, entirely outside the visible area (clipped by body's
    // overflow:hidden) — audio would play from the off-screen video with
    // nothing painted on screen.
    iframe.srcdoc = `<!doctype html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}#vpaid-slot{width:100%;height:100%;position:relative;}#vpaid-video{width:100%;height:100%;position:absolute;top:0;left:0;}</style></head><body><div id="vpaid-slot"><video id="vpaid-video" ${videoAttrString} crossorigin="anonymous"></video></div><script src="${src}"></script></body></html>`;

    return iframe;
  }

  private escapeAttr(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Pause the creative */
  pauseAd(): void {
    this.safeCall(() => this.adUnit?.pauseAd());
  }

  /** Resume the creative */
  resumeAd(): void {
    this.safeCall(() => this.adUnit?.resumeAd());
  }

  /** Stop the creative */
  stopAd(): void {
    this.safeCall(() => this.adUnit?.stopAd());
  }

  /** Ask the creative to skip itself (finalize on the resulting AdSkipped event) */
  skipAd(): void {
    this.safeCall(() => this.adUnit?.skipAd());
  }

  /** Set volume 0-1 */
  setAdVolume(volume: number): void {
    this.safeCall(() => this.adUnit?.setAdVolume(volume));
  }

  /** Notify the creative of a container resize */
  resize(width: number, height: number): void {
    this.safeCall(() => this.adUnit?.resizeAd(width, height, this.options.viewMode));
  }

  /** Ad-reported duration in seconds (0 if unavailable) */
  getDuration(): number {
    try {
      return this.adUnit?.getAdDuration() ?? 0;
    } catch {
      return 0;
    }
  }

  /** Ad-reported remaining time in seconds (0 if unavailable) */
  getRemainingTime(): number {
    try {
      return this.adUnit?.getAdRemainingTime() ?? 0;
    } catch {
      return 0;
    }
  }

  /** Ad-reported skippable state (false if unavailable) */
  getSkippableState(): boolean {
    try {
      return this.adUnit?.getAdSkippableState() ?? false;
    } catch {
      return false;
    }
  }

  private safeCall(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.log(`VPAID call failed: ${error}`);
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private clearTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Tear down the ad unit: reject any pending load(), unsubscribe raw
   * listeners first (so a stopAd()-triggered event can't re-enter our
   * handlers mid-teardown), best-effort stopAd(), remove the iframe.
   * Idempotent — safe to call multiple times or mid-load.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.settleLoad) {
      this.settleLoad.reject(
        new Error('VPAIDAdUnit destroyed before load completed')
      );
      this.settleLoad = null;
    }

    this.clearTimers();

    if (this.adUnit) {
      for (const { event, callback } of this.rawSubscriptions) {
        try {
          this.adUnit.unsubscribe(callback, event);
        } catch {
          // Ad unit may already be in a bad/torn-down state; ignore.
        }
      }
    }
    this.rawSubscriptions.length = 0;

    if (this.adUnit) {
      try {
        this.adUnit.stopAd();
      } catch {
        // Best-effort — creative may already be stopped/broken.
      }
    }
    this.adUnit = null;

    this.iframe?.remove();
    this.iframe = null;

    this.listeners.clear();
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[VPAIDAdUnit] ${message}`);
    }
  }
}
