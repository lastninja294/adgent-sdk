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
import { Ad, MediaFile, TrackingEventType, VASTErrorCode } from '@/types/vast';
import { VASTParser } from '@/core/VASTParser';
import { AdTracker } from '@/core/AdTracker';
import { PlatformAdapter, getPlatformAdapter } from '@/core/PlatformAdapter';
import { KeyAction } from '@/types/platform';

/** Default configuration */
const DEFAULT_CONFIG: Partial<AdPlayerConfig> = {
  targetBitrate: 2500,
  maxWrapperDepth: 5,
  timeout: 10000,
  debug: false,
  skipButtonText: 'Skip Ad'
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
  private tracker: AdTracker | null = null;
  
  private state: AdPlayerState;
  private ads: Ad[] = [];
  private listeners: Set<AdPlayerEventListener> = new Set();
  private quartilesFired: Set<number> = new Set();
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private focusTrap: HTMLElement | null = null;

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
    this.updateState({ status: PlaybackStatus.Loading });

    try {
      const result = await this.parser.parse(this.config.vastUrl);
      
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

      const mediaFile = this.parser.selectBestMediaFile(
        linear.mediaFiles,
        this.config.targetBitrate
      );

      if (!mediaFile) {
        throw this.createError(
          VASTErrorCode.FILE_NOT_FOUND,
          'No suitable media file found'
        );
      }

      this.updateState({ mediaFile });

      const trackingEvents = this.parser.aggregateTrackingEvents(this.ads);
      this.tracker = new AdTracker(trackingEvents, { debug: this.config.debug });
      this.tracker.updateMacroContext({ assetUri: mediaFile.url });

      this.createVideoElement(mediaFile);
      this.setupFocusManagement();
      await this.attemptAutoplay();

    } catch (error) {
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

    video.src = mediaFile.url;
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

    this.log(`Video element created with src: ${mediaFile.url}`);
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
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        z-index: 100;
      ">
        <button id="adgent-start-btn" style="
          padding: 20px 40px;
          font-size: 24px;
          background: #fff;
          color: #000;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
        ">
          ▶ Start Ad
        </button>
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
   * Handle start button click (from overlay)
   */
  private async onStartClick(): Promise<void> {
    this.removeOverlay();
    
    if (this.videoElement) {
      try {
        await this.videoElement.play();
        this.handlePlaybackStart();
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
   * Handle successful playback start
   */
  private handlePlaybackStart(): void {
    this.updateState({ status: PlaybackStatus.Playing });
    this.emit({ type: 'start' });
    this.config.onStart?.();

    const impressionUrls = this.parser.aggregateImpressions(this.ads);
    this.tracker?.fireImpressions(impressionUrls);
    this.tracker?.track('start');
    this.tracker?.track('creativeView');

    this.setupSkipButton();

    this.log('Playback started');
  }

  /**
   * Handle time updates for progress tracking
   */
  private handleTimeUpdate(video: HTMLVideoElement): void {
    const currentTime = video.currentTime;
    const duration = video.duration;
    
    if (!duration || isNaN(duration)) return;

    const percentage = (currentTime / duration) * 100;
    const quartile = this.calculateQuartile(percentage);

    this.updateState({
      currentTime,
      duration
    });

    this.updateSkipCountdown(currentTime);

    this.tracker?.updateMacroContext({ adPlayhead: currentTime });

    const progress: AdProgress = {
      currentTime,
      duration,
      percentage,
      quartile
    };
    this.emit({ type: 'progress', data: progress });
    this.config.onProgress?.(progress);

    this.fireQuartileEvents(percentage);
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
    skipBtn.textContent = `Skip in ${skipOffset}s`;
    skipBtn.addEventListener('click', () => this.skip());

    this.config.container.appendChild(skipBtn);
    this.skipButtonElement = skipBtn;
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
        this.log('Back pressed - ignoring during ad');
        break;

      case KeyAction.Play:
        this.videoElement?.play();
        break;

      case KeyAction.Pause:
        this.videoElement?.pause();
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
    if (this.videoElement) {
      this.videoElement.muted = false;
      this.updateState({ muted: false });
      this.tracker?.track('unmute');
      this.emit({ type: 'unmute' });
    }
  }

  /**
   * Mute video
   */
  mute(): void {
    if (this.videoElement) {
      this.videoElement.muted = true;
      this.updateState({ muted: true });
      this.tracker?.track('mute');
      this.emit({ type: 'mute' });
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
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }

    this.videoElement?.remove();
    this.overlayElement?.remove();
    this.skipButtonElement?.remove();
    this.focusTrap?.remove();

    this.videoElement = null;
    this.overlayElement = null;
    this.skipButtonElement = null;
    this.focusTrap = null;

    this.tracker?.reset();
    this.quartilesFired.clear();
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
      console.log(`[AdPlayer] ${message}`);
    }
  }
}

export { AdPlayer as AdgentSDK };
