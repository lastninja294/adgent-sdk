/**
 * VAST 4.x Type Definitions
 * Based on IAB VAST (Video Ad Serving Template) 4.x Specification
 * @see https://iabtechlab.com/standards/vast/
 */

/** Root VAST response structure */
export interface VASTResponse {
  version: string;
  ads: Ad[];
  errors: string[];
}

/** Ad element - can be inline or wrapper */
export interface Ad {
  id: string;
  sequence?: number;
  adSystem?: AdSystem;
  adTitle?: string;
  impressions: Impression[];
  creatives: Creative[];
  errors: string[];
  /** Present if this is a wrapper ad */
  wrapper?: Wrapper;
  /** Present if this is an inline ad */
  inLine?: InLine;
}

/** Ad system information */
export interface AdSystem {
  name: string;
  version?: string;
}

/** Inline ad content */
export interface InLine {
  adTitle: string;
  description?: string;
  advertiser?: string;
  pricing?: Pricing;
  survey?: string;
  category?: Category[];
  creatives: Creative[];
}

/** Wrapper ad - points to another VAST */
export interface Wrapper {
  vastAdTagURI: string;
  followAdditionalWrappers?: boolean;
  allowMultipleAds?: boolean;
  fallbackOnNoAd?: boolean;
}

/** Impression pixel */
export interface Impression {
  id?: string;
  url: string;
}

/** Creative element containing Linear/NonLinear/Companion ads */
export interface Creative {
  id?: string;
  sequence?: number;
  adId?: string;
  linear?: Linear;
  nonLinearAds?: NonLinearAd[];
  companionAds?: CompanionAd[];
}

/** Linear (video) ad */
export interface Linear {
  duration: number; // in seconds
  skipOffset?: number; // seconds after which skip is allowed
  mediaFiles: MediaFile[];
  trackingEvents: TrackingEvent[];
  videoClicks?: VideoClicks;
  adParameters?: string;
  icons?: Icon[];
}

/** Video file reference */
export interface MediaFile {
  id?: string;
  url: string;
  delivery: 'progressive' | 'streaming';
  type: string; // MIME type (e.g., 'video/mp4')
  width: number;
  height: number;
  bitrate?: number; // in kbps
  minBitrate?: number;
  maxBitrate?: number;
  scalable?: boolean;
  maintainAspectRatio?: boolean;
  codec?: string;
  apiFramework?: string;
}

/** Tracking event for analytics */
export interface TrackingEvent {
  event: TrackingEventType;
  url: string;
  offset?: number; // for progress events, in seconds
}

/** Supported tracking event types per VAST 4.x */
export type TrackingEventType =
  | 'creativeView'
  | 'start'
  | 'firstQuartile'
  | 'midpoint'
  | 'thirdQuartile'
  | 'complete'
  | 'mute'
  | 'unmute'
  | 'pause'
  | 'resume'
  | 'rewind'
  | 'skip'
  | 'playerExpand'
  | 'playerCollapse'
  | 'progress'
  | 'closeLinear'
  | 'loaded'
  | 'impression'
  | 'error';

/** Video click tracking */
export interface VideoClicks {
  clickThrough?: ClickThrough;
  clickTracking?: ClickTracking[];
  customClick?: CustomClick[];
}

export interface ClickThrough {
  id?: string;
  url: string;
}

export interface ClickTracking {
  id?: string;
  url: string;
}

export interface CustomClick {
  id?: string;
  url: string;
}

/** NonLinear ad (overlay) */
export interface NonLinearAd {
  id?: string;
  width: number;
  height: number;
  minSuggestedDuration?: number;
  staticResource?: string;
  iFrameResource?: string;
  htmlResource?: string;
  nonLinearClickThrough?: string;
  trackingEvents: TrackingEvent[];
}

/** Companion ad (banner alongside video) */
export interface CompanionAd {
  id?: string;
  width: number;
  height: number;
  staticResource?: string;
  iFrameResource?: string;
  htmlResource?: string;
  companionClickThrough?: string;
  trackingEvents: TrackingEvent[];
}

/** Icon overlay (e.g., AdChoices) */
export interface Icon {
  program?: string;
  width: number;
  height: number;
  xPosition: string | number;
  yPosition: string | number;
  duration?: number;
  offset?: number;
  staticResource?: string;
  iFrameResource?: string;
  htmlResource?: string;
  iconClicks?: IconClicks;
}

export interface IconClicks {
  iconClickThrough?: string;
  iconClickTracking?: string[];
}

/** Pricing information */
export interface Pricing {
  model: 'cpm' | 'cpc' | 'cpe' | 'cpv';
  currency: string;
  value: number;
}

/** Content category */
export interface Category {
  authority?: string;
  value: string;
}

/** Error codes per VAST spec */
export enum VASTErrorCode {
  XML_PARSING_ERROR = 100,
  VAST_SCHEMA_VALIDATION_ERROR = 101,
  VAST_VERSION_NOT_SUPPORTED = 102,
  GENERAL_WRAPPER_ERROR = 300,
  WRAPPER_TIMEOUT = 301,
  WRAPPER_LIMIT_REACHED = 302,
  NO_VAST_RESPONSE = 303,
  GENERAL_LINEAR_ERROR = 400,
  FILE_NOT_FOUND = 401,
  MEDIA_TIMEOUT = 402,
  MEDIA_NOT_SUPPORTED = 403,
  GENERAL_COMPANION_ERROR = 600,
  UNDEFINED_ERROR = 900
}
