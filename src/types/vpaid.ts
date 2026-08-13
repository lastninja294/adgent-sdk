/**
 * VPAID 2.0 Type Definitions
 * Based on IAB VPAID (Video Player-Ad Interface Definition) 2.0 Specification
 * @see https://iabtechlab.com/standards/vpaid/
 *
 * Only the subset of the spec this SDK actually drives is declared here.
 * Ad units expose many more members (expandAd/collapseAd, companions, icons,
 * getAdLinear, etc.) that are intentionally out of scope for v1 and are not
 * called by this SDK.
 */

/** The ad-unit object returned by a creative's `getVPAIDAd()` factory function */
export interface IVPAIDAdUnit {
  handshakeVersion(version: string): string;
  initAd(
    width: number,
    height: number,
    viewMode: string,
    desiredBitrate: number,
    creativeData: VPAIDCreativeData,
    environmentVars: VPAIDEnvironmentVars
  ): void;
  startAd(): void;
  stopAd(): void;
  resizeAd(width: number, height: number, viewMode: string): void;
  pauseAd(): void;
  resumeAd(): void;
  skipAd(): void;
  setAdVolume(volume: number): void;
  getAdVolume(): number;
  getAdSkippableState(): boolean;
  getAdRemainingTime(): number;
  getAdDuration(): number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe(callback: (...args: any[]) => void, eventName: string, context?: unknown): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsubscribe(callback: (...args: any[]) => void, eventName: string): void;
}

/**
 * VPAID events this SDK subscribes to and maps onto AdPlayer's tracking/event
 * pipeline. The spec defines additional events (AdSizeChange, AdExpandedChange,
 * AdLinearChange, AdInteraction, AdUserAcceptInvitation/Minimize/Close, AdLog)
 * that are intentionally not subscribed to in v1.
 */
export type VPAIDPlayerEventName =
  | 'AdLoaded'
  | 'AdStarted'
  | 'AdImpression'
  | 'AdVideoStart'
  | 'AdVideoFirstQuartile'
  | 'AdVideoMidpoint'
  | 'AdVideoThirdQuartile'
  | 'AdVideoComplete'
  | 'AdPaused'
  | 'AdPlaying'
  | 'AdSkipped'
  | 'AdSkippableStateChange'
  | 'AdClickThru'
  | 'AdRemainingTimeChange'
  | 'AdVolumeChange'
  | 'AdError'
  | 'AdStopped';

/** Passed to initAd() as the creative-specific data (VAST AdParameters) */
export interface VPAIDCreativeData {
  AdParameters?: string;
}

/** Passed to initAd() so the ad unit can render into the player's DOM */
export interface VPAIDEnvironmentVars {
  slot: HTMLElement;
  videoSlot: HTMLVideoElement;
  videoSlotCanAutoPlay: boolean;
}

/** Configuration for VPAIDAdUnit */
export interface VPAIDAdUnitOptions {
  /** Max time in ms to wait for the full handshake (through AdLoaded/AdError) */
  timeout?: number;
  /** VPAID viewMode passed to initAd (default: 'normal') */
  viewMode?: string;
  /** Desired bitrate in kbps passed to initAd */
  desiredBitrate?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Override iframe creation (used by tests to inject a bare iframe instead
   * of relying on a real third-party script executing under the test DOM)
   */
  createIframe?: () => HTMLIFrameElement;
}
