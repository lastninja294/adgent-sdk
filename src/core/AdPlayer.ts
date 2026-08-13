/**
 * Ad Player
 * Core video ad playback with "Nuclear Mute" strategy for TV platforms
 */

import {
  AdPlayerConfig,
  AdPlayerState,
  AdPlayerEvent,
  AdPlayerEventListener,
  AdProgress,
  AdError,
  PlaybackStatus
} from '@/types/player';
import { Ad, Linear, MediaFile, TrackingEventType, VASTErrorCode } from '@/types/vast';
import { VASTParser } from '@/core/VASTParser';
import { AdTracker } from '@/core/AdTracker';
import { PlatformAdapter, getPlatformAdapter } from '@/core/PlatformAdapter';
import { VPAIDAdUnit } from '@/core/VPAIDAdUnit';
import { KeyAction } from '@/types/platform';

/** Default configuration */
const DEFAULT_CONFIG: Partial<AdPlayerConfig> = {
  targetBitrate: 2500,
  maxWrapperDepth: 5,
  timeout: 10000,
  debug: false,
  skipButtonText: 'Skip Ad',
  enableVPAID: false,
  vpaidTimeout: 8000
};

/**
 * Ad Player with fault-tolerant playback for Smart TV platforms
 * 
 * Features:
 * - "Nuclear Mute" strategy: muted + playsinline + autoplay attributes
 * - Soft-fail autoplay: catches play() rejection, shows interactive overlay
 * - Focus management: captures remote keys during ad playback
 */
export class AdPlayer {
  private readonly config: Required<AdPlayerConfig>;
  private readonly platform: PlatformAdapter;
  private readonly parser: VASTParser;
  
  private videoElement: HTMLVideoElement | null = null;
  private overlayElement: HTMLElement | null = null;
  private skipButtonElement: HTMLElement | null = null;
  private progressElement: HTMLElement | null = null;
  private tracker: AdTracker | null = null;
  private vpaidAdUnit: VPAIDAdUnit | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private state: AdPlayerState;
  private ads: Ad[] = [];
  private listeners: Set<AdPlayerEventListener> = new Set();
  private eventListeners = new Map<string, EventListener>();
  private quartilesFired: Set<number> = new Set();
  private impressionsFired = false;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private focusTrap: HTMLElement | null = null;
  private hasStarted = false;
  private destroyed = false;
  /** True once the VPAID handshake has actually completed (unit.load() resolved) */
  private vpaidReady = false;

  constructor(config: AdPlayerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<AdPlayerConfig>;
    


    this.platform = getPlatformAdapter();
    this.parser = new VASTParser({
      maxWrapperDepth: this.config.maxWrapperDepth,
      timeout: this.config.timeout,
      debug: this.config.debug
    });

    this.state = {
      status: PlaybackStatus.Idle,
      currentTime: 0,
      duration: 0,
      muted: true,
      volume: 1,
      canSkip: false,
      skipCountdown: 0,
      mediaFile: null,
      error: null
    };

    if (this.platform.platform === 'tizen') {
      this.platform.registerTizenKeys();
    }
  }

  /**
   * Initialize the SDK: fetch VAST, create video element, attempt autoplay
   */
  async init(): Promise<void> {
    if (!this.config.container) {
      throw new Error('Container element not found');
    }

    this.updateState({ status: PlaybackStatus.Loading });

    let vpaidFailure: Error | null = null;

    try {
      const result = await this.parser.parse(this.config.vastUrl);

      // destroy() may have been called while the VAST fetch was in flight —
      // don't resurrect a video element / listeners into a torn-down player.
      if (this.destroyed) return;

      if (!result.success || !result.response) {
        throw this.createError(
          result.error?.code || VASTErrorCode.NO_VAST_RESPONSE,
          result.error?.message || 'Failed to parse VAST'
        );
      }

      this.ads = result.response.ads;

      if (this.ads.length === 0) {
        throw this.createError(
          VASTErrorCode.NO_VAST_RESPONSE,
          'No ads in VAST response'
        );
      }

      const linear = this.getFirstLinearCreative();
      if (!linear) {
        throw this.createError(
          VASTErrorCode.GENERAL_LINEAR_ERROR,
          'No linear creative found'
        );
      }

      const trackingEvents = this.parser.aggregateTrackingEvents(this.ads);
      this.tracker = new AdTracker(trackingEvents, { debug: this.config.debug });

      if (this.config.enableVPAID) {
        const vpaidMediaFile = this.parser.selectVPAIDMediaFile(linear.mediaFiles);

        if (vpaidMediaFile) {
          try {
            await this.initVPAID(vpaidMediaFile, linear);
            if (this.destroyed) return;
            this.setupFocusManagement();
            return;
          } catch (error) {
            if (this.destroyed) return;

            vpaidFailure = error instanceof Error ? error : new Error(String(error));
            this.log(`VPAID load failed, attempting native fallback: ${vpaidFailure.message}`);

            // Reset any state a premature event from the abandoned VPAID
            // attempt may have set (e.g. AdImpression firing before
            // AdLoaded/timeout) so it doesn't silently short-circuit the
            // native fallback that's about to play.
            this.impressionsFired = false;
            this.quartilesFired.clear();
            this.hasStarted = false;
          }
        }
      }

      const mediaFile = this.parser.selectBestMediaFile(
        linear.mediaFiles,
        this.config.targetBitrate
      );

      if (!mediaFile) {
        throw vpaidFailure
          ? this.createError(VASTErrorCode.VPAID_ERROR, vpaidFailure.message)
          : this.createError(VASTErrorCode.FILE_NOT_FOUND, 'No suitable media file found');
      }

      this.updateState({ mediaFile });
      this.tracker.updateMacroContext({ assetUri: mediaFile.url });

      this.createVideoElement(mediaFile);
      this.setupFocusManagement();
      await this.attemptAutoplay();

    } catch (error) {
      if (this.destroyed) return;

      const adError = error instanceof Error
        ? this.createError(VASTErrorCode.UNDEFINED_ERROR, error.message)
        : error as AdError;

      this.handleError(adError);
    }
  }

  /**
   * Get the first linear creative from parsed ads
   */
  private getFirstLinearCreative() {
    for (const ad of this.ads) {
      for (const creative of ad.creatives) {
        if (creative.linear) {
          return creative.linear;
        }
      }
    }
    return null;
  }

  /**
   * Load and drive a VPAID 2.0 creative (opt-in, see config.enableVPAID).
   * Wires the VPAID lifecycle onto the same tracker/event/callback pipeline
   * the native <video> path uses. Throws if load() fails/times out — the
   * caller (init()) decides whether to fall back to a native MediaFile.
   */
  private async initVPAID(mediaFile: MediaFile, linear: Linear): Promise<void> {
    this.tracker?.updateMacroContext({ assetUri: mediaFile.url });
    this.updateState({ mediaFile });

    const unit = new VPAIDAdUnit(
      this.config.container,
      mediaFile,
      linear,
      this.platform,
      {
        timeout: this.config.vpaidTimeout,
        desiredBitrate: this.config.targetBitrate,
        debug: this.config.debug
      }
    );

    unit.on('AdImpression', () => this.fireImpressionPixels());
    unit.on('AdStarted', () => this.fireImpressionPixels());

    unit.on('AdVideoStart', () => this.handleVPAIDPlayOrResume());
    unit.on('AdPlaying', () => this.handleVPAIDPlayOrResume());

    // Reuses the same quartilesFired set the native percentage-based path
    // uses, guarding against a creative re-dispatching a quartile event
    // (buggy creative, or a re-fire after a seek/ad-pod stitch) from
    // double-tracking or double-emitting to host listeners.
    unit.on('AdVideoFirstQuartile', () => {
      if (this.quartilesFired.has(25)) return;
      this.quartilesFired.add(25);
      this.tracker?.track('firstQuartile');
      this.emit({ type: 'quartile', data: { quartile: 'firstQuartile' } });
    });

    unit.on('AdVideoMidpoint', () => {
      if (this.quartilesFired.has(50)) return;
      this.quartilesFired.add(50);
      this.tracker?.track('midpoint');
      this.emit({ type: 'quartile', data: { quartile: 'midpoint' } });
    });

    unit.on('AdVideoThirdQuartile', () => {
      if (this.quartilesFired.has(75)) return;
      this.quartilesFired.add(75);
      this.tracker?.track('thirdQuartile');
      this.emit({ type: 'quartile', data: { quartile: 'thirdQuartile' } });
    });

    unit.on('AdVideoComplete', () => this.handleComplete());

    unit.on('AdPaused', () => {
      if (this.state.status !== PlaybackStatus.Completed) {
        this.updateState({ status: PlaybackStatus.Paused });
        this.emit({ type: 'pause' });
        this.tracker?.track('pause');
      }
    });

    unit.on('AdSkippableStateChange', () => {
      // Some creatives report skippable state synchronously from within
      // initAd(), before startAd() has ever been called — ignore it until
      // the ad has actually started; handleVPAIDPlayOrResume() re-checks
      // getSkippableState() itself once it does.
      if (!this.hasStarted) return;

      if (unit.getSkippableState()) {
        this.showVPAIDSkipButton();
      } else {
        this.hideVPAIDSkipButton();
      }
    });

    unit.on('AdSkipped', () => this.finalizeSkip());

    unit.on('AdClickThru', (url?: string, _id?: string, playerHandles?: boolean) => {
      this.handleVPAIDClickThru(linear, url, playerHandles);
    });

    unit.on('AdRemainingTimeChange', (remaining?: number) => {
      const duration = unit.getDuration();
      // duration > 0 already excludes NaN duration (NaN > 0 is false);
      // remaining still needs its own explicit isNaN check since typeof
      // NaN === 'number'.
      if (typeof remaining === 'number' && !isNaN(remaining) && duration > 0) {
        this.updateProgress(Math.max(0, duration - remaining), duration);
      }
    });

    unit.on('AdError', (message?: string) => {
      this.handleError(
        this.createError(
          VASTErrorCode.VPAID_ERROR,
          typeof message === 'string' ? message : 'VPAID ad error'
        )
      );
    });

    // Assigned before await so a concurrent destroy() during load() can
    // still reach and tear down this ad unit (VPAIDAdUnit.destroy() is
    // idempotent and safe to call mid-load).
    this.vpaidAdUnit = unit;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        const { clientWidth, clientHeight } = this.config.container;
        if (clientWidth > 0 && clientHeight > 0) {
          unit.resize(clientWidth, clientHeight);
        }
      });
      this.resizeObserver.observe(this.config.container);
    }

    try {
      await unit.load();
      this.vpaidReady = true;
    } catch (error) {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.vpaidAdUnit = null;
      unit.destroy();
      throw error;
    }
  }

  /**
   * First-play/resume handling for VPAID. Deliberately does not reuse
   * handlePlaybackStart(): that method calls setupSkipButton(), which is
   * driven by VAST skipoffset and would leave a stuck, non-clickable "Skip
   * in Ns" button if a VPAID creative's Linear also happened to carry a
   * skipoffset — VPAID skippability is boolean-driven via
   * AdSkippableStateChange/getAdSkippableState() instead.
   *
   * Both AdVideoStart and AdPlaying route here, but only status === Paused
   * is treated as an actual resume — many real creatives fire AdPlaying
   * immediately after AdVideoStart as a generic "now playing" signal, not
   * exclusively after a pause, and reacting to that as a resume would fire
   * a spurious 'resume' event/pixel right after the ad starts.
   */
  private handleVPAIDPlayOrResume(): void {
    if (this.state.status === PlaybackStatus.Paused) {
      this.handleResume();
      return;
    }

    // Already started and not paused — e.g. a duplicate AdVideoStart/
    // AdPlaying, or one arriving after the ad reached a terminal state.
    // Nothing to do.
    if (this.hasStarted) return;

    this.hasStarted = true;
    this.updateState({ status: PlaybackStatus.Playing });
    this.emit({ type: 'start' });
    this.config.onStart?.();

    this.fireImpressionPixels();
    this.tracker?.track('start');
    this.tracker?.track('creativeView');

    this.setupProgressUI();

    if (this.vpaidAdUnit?.getSkippableState()) {
      this.showVPAIDSkipButton();
    }

    this.log('VPAID playback started');
  }

  /**
   * Show the VPAID skip button (boolean-driven, no countdown text — VPAID
   * doesn't expose an offset, only a skippable/not-skippable state).
   */
  private showVPAIDSkipButton(): void {
    this.updateState({ canSkip: true, skipCountdown: 0 });

    if (this.skipButtonElement) return;

    const skipBtn = this.createSkipButton(this.config.skipButtonText);
    this.config.container.appendChild(skipBtn);
    this.skipButtonElement = skipBtn;
  }

  /**
   * Hide the VPAID skip button (creative reported skippable: false again)
   */
  private hideVPAIDSkipButton(): void {
    this.updateState({ canSkip: false });
    this.skipButtonElement?.remove();
    this.skipButtonElement = null;
  }

  /**
   * Handle a VPAID AdClickThru event. Falls back to the VAST ClickThrough
   * URL when the creative doesn't supply one (common with GAM/SSP wrappers).
   */
  private handleVPAIDClickThru(linear: Linear, url?: string, playerHandles?: boolean): void {
    const clickThroughUrl = url || linear.videoClicks?.clickThrough?.url;
    if (!clickThroughUrl) return;

    const clickTracking = linear.videoClicks?.clickTracking || [];
    clickTracking.forEach(tracking => {
      if (tracking.url) this.tracker?.firePixel(tracking.url);
    });

    if (playerHandles) {
      this.platform.openExternalLink(clickThroughUrl);
    }

    this.emit({ type: 'click', data: { url: clickThroughUrl } });
    this.config.onClick?.(clickThroughUrl);
  }

  /**
   * Create video element with "Nuclear Mute" strategy
   * Applies muted, playsinline, autoplay for maximum TV compatibility
   */
  private createVideoElement(mediaFile: MediaFile): void {
    const video = document.createElement('video');
    
    const attrs = this.platform.getVideoAttributes();
    Object.entries(attrs).forEach(([key, value]) => {
      if (typeof value === 'boolean') {
        if (value) video.setAttribute(key, '');
      } else {
        video.setAttribute(key, value);
      }
    });

    video.removeAttribute('src'); 
    video.innerHTML = '';
    
    const source = document.createElement('source');
    source.src = mediaFile.url;
    source.type = mediaFile.type || 'video/mp4'; 
    video.appendChild(source);

    // WebOS often requires CORS for CDN content
    video.setAttribute('crossorigin', 'anonymous');
    video.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    `;

    video.addEventListener('loadedmetadata', () => {
      this.updateState({ 
        duration: video.duration,
        status: PlaybackStatus.Ready 
      });
      this.emit({ type: 'loaded' });
    });

    video.addEventListener('timeupdate', () => {
      this.handleTimeUpdate(video);
    });

    video.addEventListener('ended', () => {
      this.handleComplete();
    });

    video.addEventListener('error', () => {
      const error = video.error;
      this.handleError(
        this.createError(
          VASTErrorCode.MEDIA_NOT_SUPPORTED,
          error?.message || 'Video playback error'
        )
      );
    });

    video.addEventListener('play', () => {
      this.updateState({ status: PlaybackStatus.Playing });
    });

    video.addEventListener('pause', () => {
      if (this.state.status !== PlaybackStatus.Completed) {
        this.updateState({ status: PlaybackStatus.Paused });
        this.emit({ type: 'pause' });
        this.tracker?.track('pause');
      }
    });

    // Append to container
    this.config.container.appendChild(video);
    this.videoElement = video;

    if (this.config.debug) {
      const events = ['loadstart', 'loadeddata', 'canplay', 'waiting', 'playing'];
      events.forEach(event => {
        const listener = () => this.log(`Video ${event}`);
        video.addEventListener(event, listener);
        this.eventListeners.set(event, listener);
      });
      
      const onPlay = () => this.log("Video play event");
      video.addEventListener("play", onPlay);
      this.eventListeners.set("play", onPlay);
    }

    this.log(`Video element created with src: ${mediaFile.url}`);

    video.addEventListener('click', () => {
      this.onAdClick();
    });
    
    video.style.cursor = 'pointer';
  }

  /**
   * Attempt autoplay with soft-fail handling
   * If play() rejects (common on TVs), show interactive overlay
   */
  private async attemptAutoplay(): Promise<void> {
    if (!this.videoElement) return;

    try {
      await this.videoElement.play();
      this.handlePlaybackStart();
    } catch (error) {
      console.error('[Adgent] Autoplay failed details:', error);
      // Soft-fail: show "Start Ad" overlay instead of crashing
      this.log(`Autoplay failed: ${error}`);
      this.showStartOverlay();
    }
  }

  /**
   * Show interactive overlay for manual ad start (autoplay fallback)
   */
  private showStartOverlay(): void {
    this.updateState({ status: PlaybackStatus.WaitingForInteraction });

    if (this.config.customStartOverlay) {
      this.overlayElement = this.config.customStartOverlay;
      this.config.container.appendChild(this.overlayElement);
      return;
    }

    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <div style="
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: table;
        background: rgba(0, 0, 0, 0.5);
        z-index: 100;
      ">
        <div style="display: table-cell; vertical-align: middle; text-align: center;">
          <button id="adgent-start-btn" style="
            width: 80px;
            height: 80px;
            background: rgba(0, 0, 0, 0.7);
            border: 3px solid #fff;
            border-radius: 50%;
            cursor: pointer;
            display: inline-block;
            line-height: 80px;
            text-align: center;
            color: #fff;
            font-size: 40px;
            padding: 0 0 0 8px; /* Optical center for triangle */
          ">
            ▶
          </button>
        </div>
      </div>
    `;
    overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';

    const button = overlay.querySelector('#adgent-start-btn');
    button?.addEventListener('click', () => this.onStartClick());

    this.config.container.style.position = 'relative';
    this.config.container.appendChild(overlay);
    this.overlayElement = overlay;

    (button as HTMLElement)?.focus();
  }

  /**
   * Handle ad click (video element click)
   */
  private onAdClick(): void {
    if (this.state.status !== PlaybackStatus.Playing) return;

    const linear = this.getFirstLinearCreative();
    if (!linear) return;

    // Get ClickThrough URL
    const clickThrough = linear.videoClicks?.clickThrough;
    const url = clickThrough?.url;

    if (url) {
      this.log(`Ad clicked. Opening: ${url}`);
      
      // Pause playback
      this.videoElement?.pause();
      
      // Show play button so user can resume
      this.showStartOverlay();
      
      // Fire tracking pixels
      const clickTracking = linear.videoClicks?.clickTracking || [];
      
      clickTracking.forEach(tracking => {
        if (tracking.url) this.tracker?.firePixel(tracking.url);
      });

      // Open URL
      this.platform.openExternalLink(url);
      
      // Emit event
      this.emit({ type: 'click', data: { url } });
      this.config.onClick?.(url);
    }
  }

  /**
   * Handle start button click (from overlay)
   */
  private async onStartClick(): Promise<void> {
    this.removeOverlay();

    if (this.videoElement) {
      try {
        await this.videoElement.play();
        this.handlePlayOrResume();
      } catch (error) {
        this.handleError(
          this.createError(
            VASTErrorCode.GENERAL_LINEAR_ERROR,
            `Playback failed: ${error}`
          )
        );
      }
    }
  }

  /**
   * Remove the start overlay
   */
  private removeOverlay(): void {
    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
  }

  /**
   * If already started once, this is a Resume action; otherwise the first
   * playback start. Shared by onStartClick() (autoplay-fallback overlay).
   * Deliberately keyed on hasStarted rather than status === Paused: the
   * native <video>'s 'pause' event fires as a queued task per spec (not
   * synchronously with the pause() call in onAdClick()), so status may not
   * have flipped to Paused yet by the time the resume click lands close
   * behind it — hasStarted has no such timing dependency.
   */
  private handlePlayOrResume(): void {
    if (this.hasStarted) {
      this.handleResume();
    } else {
      this.handlePlaybackStart();
    }
  }

  /**
   * Shared resume bookkeeping for both the native and VPAID paths. Callers
   * are expected to have already confirmed status === Paused.
   */
  private handleResume(): void {
    this.updateState({ status: PlaybackStatus.Playing });
    this.emit({ type: 'resume' });
    this.tracker?.track('resume');
  }

  /**
   * Handle successful playback start
   */
  private handlePlaybackStart(): void {
    this.hasStarted = true;
    this.updateState({ status: PlaybackStatus.Playing });
    this.emit({ type: 'start' });
    this.config.onStart?.();

    this.fireImpressionPixels();
    this.tracker?.track('start');
    this.tracker?.track('creativeView');

    this.setupSkipButton();
    this.setupProgressUI();

    this.log('Playback started');
  }

  /**
   * Fire VAST impression pixels exactly once. Idempotent because VPAID
   * creatives commonly signal impression via more than one event
   * (AdImpression, AdStarted, AdVideoStart) and AdTracker.fireImpressions()
   * itself has no dedup.
   */
  private fireImpressionPixels(): void {
    if (this.impressionsFired) return;
    this.impressionsFired = true;

    const impressionUrls = this.parser.aggregateImpressions(this.ads);
    this.tracker?.fireImpressions(impressionUrls);
  }

  /**
   * Handle time updates for progress tracking
   */
  private handleTimeUpdate(video: HTMLVideoElement): void {
    const currentTime = video.currentTime;
    const duration = video.duration;

    if (!duration || isNaN(duration)) return;

    this.updateProgress(currentTime, duration);
    this.updateSkipCountdown(currentTime);

    const percentage = (currentTime / duration) * 100;
    this.fireQuartileEvents(percentage);
  }

  /**
   * Shared progress bookkeeping (state, macro context, progress UI, emit).
   * Used by the native <video> timeupdate path and VPAID's
   * AdRemainingTimeChange path. Deliberately excludes skip-countdown and
   * quartile firing — native quartiles come from percentage math here,
   * VPAID quartiles come from explicit ad-unit events instead, and VPAID's
   * skip button is boolean-driven rather than offset/countdown-driven.
   *
   * Callers are expected to have already validated duration/currentTime
   * (handleTimeUpdate checks duration; the AdRemainingTimeChange handler
   * checks both duration and remaining, which currentTime is derived from).
   */
  private updateProgress(currentTime: number, duration: number): void {
    const percentage = (currentTime / duration) * 100;
    const quartile = this.calculateQuartile(percentage);

    this.updateState({ currentTime, duration });
    this.tracker?.updateMacroContext({ adPlayhead: currentTime });
    this.updateProgressUI(currentTime, duration);

    const progress: AdProgress = {
      currentTime,
      duration,
      percentage,
      quartile
    };
    this.emit({ type: 'progress', data: progress });
    this.config.onProgress?.(progress);
  }

  /**
   * Calculate current quartile (0-4)
   */
  private calculateQuartile(percentage: number): 0 | 1 | 2 | 3 | 4 {
    if (percentage >= 100) return 4;
    if (percentage >= 75) return 3;
    if (percentage >= 50) return 2;
    if (percentage >= 25) return 1;
    return 0;
  }

  /**
   * Fire quartile tracking events
   */
  private fireQuartileEvents(percentage: number): void {
    const quartiles: Array<{ threshold: number; event: TrackingEventType }> = [
      { threshold: 25, event: 'firstQuartile' },
      { threshold: 50, event: 'midpoint' },
      { threshold: 75, event: 'thirdQuartile' }
    ];

    for (const { threshold, event } of quartiles) {
      if (percentage >= threshold && !this.quartilesFired.has(threshold)) {
        this.quartilesFired.add(threshold);
        this.tracker?.track(event);
        this.emit({ type: 'quartile', data: { quartile: event } });
        this.log(`Quartile fired: ${event}`);
      }
    }
  }

  /**
   * Set up skip button
   */
  private setupSkipButton(): void {
    const linear = this.getFirstLinearCreative();
    const skipOffset = this.config.skipOffset ?? linear?.skipOffset;

    if (!skipOffset || skipOffset <= 0) {
      return;
    }

    this.updateState({ skipCountdown: skipOffset, canSkip: false });

    const skipBtn = this.createSkipButton(`Skip in ${skipOffset}s`);
    this.config.container.appendChild(skipBtn);
    this.skipButtonElement = skipBtn;
  }

  /**
   * Shared #adgent-skip-btn markup for both the native (offset/countdown)
   * and VPAID (boolean-state) skip buttons — only the initial text and
   * click handler differ; updateSkipCountdown() mutates text/opacity on
   * the native path afterward.
   */
  private createSkipButton(text: string): HTMLButtonElement {
    const skipBtn = document.createElement('button');
    skipBtn.id = 'adgent-skip-btn';
    skipBtn.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      padding: 12px 24px;
      font-size: 16px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      border: 2px solid #fff;
      border-radius: 4px;
      cursor: pointer;
      z-index: 101;
      transition: opacity 0.3s;
    `;
    skipBtn.textContent = text;
    skipBtn.addEventListener('click', () => this.skip());
    return skipBtn;
  }

  /**
   * Update skip countdown
   */
  private updateSkipCountdown(currentTime: number): void {
    const linear = this.getFirstLinearCreative();
    const skipOffset = this.config.skipOffset ?? linear?.skipOffset;

    if (!skipOffset || !this.skipButtonElement) return;

    const remaining = Math.max(0, skipOffset - currentTime);
    this.updateState({ skipCountdown: remaining });

    if (remaining <= 0 && !this.state.canSkip) {
      this.updateState({ canSkip: true });
      this.skipButtonElement.textContent = this.config.skipButtonText;
      this.skipButtonElement.style.opacity = '1';
      this.skipButtonElement.focus(); // Auto-focus when available
    } else if (remaining > 0) {
      this.skipButtonElement.textContent = `Skip in ${Math.ceil(remaining)}s`;
      this.skipButtonElement.style.opacity = '0.6';
    }
  }

  /**
   * Skip the ad
   */
  skip(): void {
    if (!this.state.canSkip) {
      this.log('Skip not available yet');
      return;
    }

    if (this.vpaidAdUnit) {
      // Finalize happens on the resulting AdSkipped event, not synchronously
      this.vpaidAdUnit.skipAd();
      return;
    }

    this.finalizeSkip();
  }

  /**
   * Complete the skip: track, emit, callback, destroy. Called synchronously
   * for the native path, and from the VPAID AdSkipped event handler.
   */
  private finalizeSkip(): void {
    this.tracker?.track('skip');
    this.emit({ type: 'skip' });
    this.config.onSkip?.();
    this.destroy();

    this.log('Ad skipped');
  }

  /**
   * Handle ad completion
   */
  private handleComplete(): void {
    // Guards two real-world cases: a VPAID creative firing AdVideoComplete
    // after it already reported a (non-fatal, from its perspective) AdError
    // — status is already Error, don't also report completion — and a
    // creative that re-fires AdVideoComplete, which would otherwise
    // re-invoke onComplete for an ad already reported complete.
    if (
      this.state.status === PlaybackStatus.Error ||
      this.state.status === PlaybackStatus.Completed
    ) {
      return;
    }

    this.updateState({ status: PlaybackStatus.Completed });
    this.tracker?.track('complete');
    this.emit({ type: 'complete' });
    this.config.onComplete?.();

    this.log('Ad completed');
  }

  /**
   * Handle errors with recovery attempt or callback
   */
  private handleError(error: AdError): void {
    this.updateState({ 
      status: PlaybackStatus.Error,
      error 
    });

    const errorUrls: string[] = [];
    for (const ad of this.ads) {
      errorUrls.push(...ad.errors);
    }
    this.tracker?.fireError(errorUrls, error.code);

    this.emit({ type: 'error', data: error });
    this.config.onError?.(error);

    this.log(`Error: ${error.message}`);
  }

  /**
   * Set up focus management to capture remote keys
   */
  private setupFocusManagement(): void {
    this.focusTrap = document.createElement('div');
    this.focusTrap.tabIndex = 0;
    this.focusTrap.style.cssText = 'position: absolute; opacity: 0; width: 0; height: 0;';
    this.config.container.appendChild(this.focusTrap);
    this.focusTrap.focus();

    this.boundKeyHandler = (e: KeyboardEvent) => {
      const action = this.platform.normalizeKeyCode(e.keyCode);
      
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        this.handleKeyAction(action);
      }
    };

    document.addEventListener('keydown', this.boundKeyHandler, true);
  }

  /**
   * Set up progress UI in top-left
   */
  private setupProgressUI(): void {
    const container = document.createElement('div');
    container.style.cssText = `
      position: absolute;
      top: 20px;
      left: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 14px;
      font-family: sans-serif;
      z-index: 101;
      display: block;
      white-space: nowrap;
    `;
    
    // Initial content
    container.innerHTML = `
      <span style="display: inline-block; vertical-align: middle; margin-right: 8px; background: #f4b400; color: #000; padding: 2px 4px; border-radius: 2px; font-weight: bold; font-size: 12px;">Ad</span>
      <span id="adgent-progress-text" style="display: inline-block; vertical-align: middle;">1 of ${this.ads.length} • 0:00</span>
    `;

    this.config.container.appendChild(container);
    this.progressElement = container;
  }

  /**
   * Update progress UI text
   */
  private updateProgressUI(currentTime: number, duration: number): void {
    if (!this.progressElement) return;

    const remaining = Math.ceil(duration - currentTime);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    const textEl = this.progressElement.querySelector('#adgent-progress-text');
    if (textEl) {
      // Assuming single linear ad for now, can be expanded for pods
      const currentAdIndex = 1; 
      textEl.textContent = `${currentAdIndex} of ${this.ads.length} • ${timeText}`;
    }
  }

  /**
   * Handle key actions from remote control
   */
  private handleKeyAction(action: KeyAction): void {
    this.log(`Key action: ${action}`);

    switch (action) {
      case KeyAction.Enter:
        if (this.state.status === PlaybackStatus.WaitingForInteraction) {
          this.onStartClick();
        } else if (this.state.canSkip) {
          this.skip();
        }
        break;

      case KeyAction.Back:
        if (this.config.onClose) {
          this.log('Back pressed - user cancelling');
          this.config.onClose();
          this.destroy();
        } else {
          this.log('Back pressed - skipping');
          this.emit({ type: 'skip' });
          if (this.config.onSkip) this.config.onSkip();
          this.destroy();
        }
        break;

      case KeyAction.Play:
        this.controlPlay();
        break;

      case KeyAction.Pause:
        this.controlPause();
        break;

      case KeyAction.Left:
      case KeyAction.Right:
      case KeyAction.Up:
      case KeyAction.Down:
        break;
    }
  }

  /**
   * Unmute video (call after playback starts if needed)
   */
  unmute(): void {
    if (this.vpaidAdUnit) {
      // vpaidAdUnit is assigned before the handshake completes (see
      // initVPAID) so a concurrent destroy() can still reach it — but that
      // means setAdVolume() would silently no-op on the not-yet-ready raw
      // ad unit. Don't report state/fire tracking for an action that
      // didn't actually reach the creative.
      if (!this.vpaidReady) return;
    } else if (!this.videoElement) {
      return;
    }

    this.controlSetMuted(false);
    this.updateState({ muted: false });
    this.tracker?.track('unmute');
    this.emit({ type: 'unmute' });
  }

  /**
   * Mute video
   */
  mute(): void {
    if (this.vpaidAdUnit) {
      if (!this.vpaidReady) return;
    } else if (!this.videoElement) {
      return;
    }

    this.controlSetMuted(true);
    this.updateState({ muted: true });
    this.tracker?.track('mute');
    this.emit({ type: 'mute' });
  }

  /**
   * Route a play command to whichever backend is active (VPAID ad unit or
   * native <video>).
   */
  private controlPlay(): void {
    if (this.vpaidAdUnit) {
      this.vpaidAdUnit.resumeAd();
    } else {
      this.videoElement?.play();
    }
  }

  /**
   * Route a pause command to whichever backend is active.
   */
  private controlPause(): void {
    if (this.vpaidAdUnit) {
      this.vpaidAdUnit.pauseAd();
    } else {
      this.videoElement?.pause();
    }
  }

  /**
   * Route a mute/unmute command to whichever backend is active. Callers
   * are expected to have already confirmed that backend is ready to act
   * (see the vpaidReady/videoElement checks in mute()/unmute()).
   */
  private controlSetMuted(muted: boolean): void {
    if (this.vpaidAdUnit) {
      this.vpaidAdUnit.setAdVolume(muted ? 0 : 1);
    } else if (this.videoElement) {
      this.videoElement.muted = muted;
    }
  }

  /**
   * Add event listener
   */
  on(listener: AdPlayerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current state
   */
  getState(): AdPlayerState {
    return { ...this.state };
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.destroyed = true;
    this.vpaidReady = false;

    if (this.vpaidAdUnit) {
      const unit = this.vpaidAdUnit;
      this.vpaidAdUnit = null;
      unit.destroy();
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }

    if (this.videoElement) {
      this.eventListeners.forEach((listener, event) => {
        this.videoElement?.removeEventListener(event, listener);
      });
      this.eventListeners.clear();
      this.videoElement.remove();
    }
    this.overlayElement?.remove();
    this.skipButtonElement?.remove();
    this.progressElement?.remove();
    this.focusTrap?.remove();

    this.videoElement = null;
    this.overlayElement = null;
    this.skipButtonElement = null;
    this.progressElement = null;
    this.focusTrap = null;

    this.tracker?.reset();
    this.quartilesFired.clear();
    this.impressionsFired = false;
    this.listeners.clear();
    this.ads = [];

    this.emit({ type: 'destroy' });
    this.log('Player destroyed');
  }

  /**
   * Update internal state
   */
  private updateState(partial: Partial<AdPlayerState>): void {
    this.state = { ...this.state, ...partial };
  }

  /**
   * Emit event to listeners
   */
  private emit(event: AdPlayerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.log(`Listener error: ${error}`);
      }
    }
  }

  /**
   * Create error object
   */
  private createError(
    code: VASTErrorCode | number,
    message: string,
    recoverable = false
  ): AdError {
    return { code, message, recoverable };
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      this.platform.debug(message);
    }
  }
}

export { AdPlayer as AdgentSDK };
