/**
 * Ad Tracker
 * Fire-and-forget pixel tracking with sendBeacon/fetch fallback
 */

import { TrackingEvent, TrackingEventType } from '@/types/vast';
import { replaceMacros, MacroContext } from '@/utils/macros';
import { getPlatformAdapter } from '@/core/PlatformAdapter';

/** Tracker configuration */
export interface TrackerConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Retry failed requests (default: false for fire-and-forget) */
  retry?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
}

/**
 * Fire-and-forget pixel tracker for VAST events
 */
export class AdTracker {
  private readonly config: Required<TrackerConfig>;
  private readonly trackingEvents: Map<TrackingEventType, TrackingEvent[]>;
  private firedEvents: Set<string>;
  private macroContext: MacroContext;

  constructor(
    events: TrackingEvent[] = [],
    config: TrackerConfig = {}
  ) {
    this.config = {
      debug: config.debug ?? false,
      retry: config.retry ?? false,
      maxRetries: config.maxRetries ?? 3
    };

    this.trackingEvents = this.groupEventsByType(events);
    this.firedEvents = new Set();
    this.macroContext = {};
  }

  /**
   * Group tracking events by their event type
   */
  private groupEventsByType(
    events: TrackingEvent[]
  ): Map<TrackingEventType, TrackingEvent[]> {
    const map = new Map<TrackingEventType, TrackingEvent[]>();
    
    for (const event of events) {
      const list = map.get(event.event) || [];
      list.push(event);
      map.set(event.event, list);
    }
    
    return map;
  }

  /**
   * Update macro context for URL replacement
   */
  updateMacroContext(context: Partial<MacroContext>): void {
    this.macroContext = { ...this.macroContext, ...context };
  }

  /**
   * Track a specific event type
   * @param eventType - The VAST event type to track
   * @param once - Only fire once per event type (default: true)
   */
  track(eventType: TrackingEventType, once = true): void {
    const events = this.trackingEvents.get(eventType);
    if (!events) {
      this.log(`No tracking URLs for event: ${eventType}`);
      return;
    }

    for (const event of events) {
      const eventKey = `${eventType}:${event.url}`;
      
      if (once && this.firedEvents.has(eventKey)) {
        this.log(`Skipping duplicate event: ${eventType}`);
        continue;
      }

      const url = replaceMacros(event.url, this.macroContext);
      this.firePixel(url);
      
      if (once) {
        this.firedEvents.add(eventKey);
      }
    }
  }

  /**
   * Fire a single tracking pixel (fire-and-forget)
   * Uses sendBeacon when available, falls back to fetch with keepalive
   */
  firePixel(url: string): void {
    const platform = getPlatformAdapter();
    
    this.log(`Firing pixel: ${url}`);

    try {
      if (platform.capabilities.sendBeacon && navigator.sendBeacon(url)) {
        return;
      }

      if (platform.capabilities.fetchKeepalive) {
        fetch(url, {
          method: 'GET',
          keepalive: true,
          mode: 'no-cors',
          credentials: 'omit'
        }).catch(() => {
        });
        return;
      }

      this.fireImageBeacon(url);
    } catch {
      this.log(`Failed to fire pixel: ${url}`);
    }
  }

  /**
   * Image beacon fallback
   */
  private fireImageBeacon(url: string): void {
    const img = new Image(1, 1);
    img.src = url;
  }

  /**
   * Fire impression pixels
   * @param impressionUrls - Array of impression URLs
   */
  fireImpressions(impressionUrls: string[]): void {
    for (const url of impressionUrls) {
      const processedUrl = replaceMacros(url, this.macroContext);
      this.firePixel(processedUrl);
    }
  }

  /**
   * Fire error tracking with error code
   * @param errorUrls - Array of error tracking URLs
   * @param errorCode - VAST error code
   */
  fireError(errorUrls: string[], errorCode: number): void {
    const context = { ...this.macroContext, errorCode };
    
    for (const url of errorUrls) {
      const processedUrl = replaceMacros(url, context);
      this.firePixel(processedUrl);
    }
  }

  /**
   * Reset fired events (for replay scenarios)
   */
  reset(): void {
    this.firedEvents.clear();
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[AdTracker] ${message}`);
    }
  }
}
