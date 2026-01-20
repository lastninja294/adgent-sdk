/**
 * Player Types
 * Configuration, state, and event definitions for AdPlayer
 */

import { TrackingEventType, MediaFile, VASTErrorCode } from '@/types/vast';

/** SDK initialization configuration */
export interface AdPlayerConfig {
  /** Container element to render ad player into */
  container: HTMLElement;
  
  /** VAST tag URL to fetch */
  vastUrl: string;
  
  /** Target bitrate in kbps (default: 2500 for ~1080p) */
  targetBitrate?: number;
  
  /** Maximum VAST wrapper depth (default: 5) */
  maxWrapperDepth?: number;
  
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
  
  /** Enable debug logging (default: false) */
  debug?: boolean;
  
  /** Custom skip button text */
  skipButtonText?: string;
  
  /** Skip offset override in seconds (0 = no skip allowed) */
  skipOffset?: number;
  
  /** Callback when ad playback completes */
  onComplete?: () => void;
  
  /** Callback when an error occurs */
  onError?: (error: AdError) => void;
  
  /** Callback when ad starts playing */
  onStart?: () => void;
  
  /** Callback for progress updates */
  onProgress?: (progress: AdProgress) => void;
  
  /** Callback when ad is skipped */
  onSkip?: () => void;
  
  /** Callback when user clicks the ad */
  onClick?: (clickThroughUrl: string) => void;
  
  /** Callback when ad is paused */
  onPause?: () => void;
  
  /** Callback when ad resumes */
  onResume?: () => void;
  
  /** Custom "Start Ad" overlay UI (for autoplay fallback) */
  customStartOverlay?: HTMLElement;

  /** Callback key-action Back or Exit */
  onClose?: () => void;
}

/** Current player state */
export interface AdPlayerState {
  /** Current playback status */
  status: PlaybackStatus;
  
  /** Current playback time in seconds */
  currentTime: number;
  
  /** Total duration in seconds */
  duration: number;
  
  /** Whether ad is muted */
  muted: boolean;
  
  /** Current volume (0-1) */
  volume: number;
  
  /** Whether skip is available */
  canSkip: boolean;
  
  /** Seconds until skip is available */
  skipCountdown: number;
  
  /** Selected media file being played */
  mediaFile: MediaFile | null;
  
  /** Last error if any */
  error: AdError | null;
}

/** Playback status enum */
export enum PlaybackStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Playing = 'playing',
  Paused = 'paused',
  Completed = 'completed',
  Error = 'error',
  WaitingForInteraction = 'waiting_for_interaction'
}

/** Progress event data */
export interface AdProgress {
  currentTime: number;
  duration: number;
  percentage: number;
  quartile: 0 | 1 | 2 | 3 | 4; // 0=start, 1=25%, 2=50%, 3=75%, 4=complete
}

/** Error structure */
export interface AdError {
  code: VASTErrorCode | number;
  message: string;
  details?: string;
  recoverable: boolean;
}

/** Events emitted by the player */
export type AdPlayerEvent = 
  | { type: 'loaded' }
  | { type: 'start' }
  | { type: 'progress'; data: AdProgress }
  | { type: 'quartile'; data: { quartile: TrackingEventType } }
  | { type: 'complete' }
  | { type: 'skip' }
  | { type: 'click'; data: { url: string } }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'error'; data: AdError }
  | { type: 'destroy' };

/** Event listener callback */
export type AdPlayerEventListener = (event: AdPlayerEvent) => void;
