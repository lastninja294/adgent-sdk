/**
 * VAST Parser
 * Parses VAST XML and resolves wrapper chains
 */

import { XMLParser } from 'fast-xml-parser';
import {
  VASTResponse,
  Ad,
  Creative,
  Linear,
  MediaFile,
  TrackingEvent,
  Impression,
  VASTErrorCode
} from '@/types/vast';

/** Parser configuration */
export interface VASTParserConfig {
  /** Maximum wrapper depth (default: 5) */
  maxWrapperDepth?: number;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom fetch implementation */
  fetchFn?: typeof fetch;
}

/** Parse result */
export interface ParseResult {
  success: boolean;
  response?: VASTResponse;
  error?: {
    code: VASTErrorCode;
    message: string;
  };
}

/**
 * VAST XML Parser with wrapper resolution
 */
export class VASTParser {
  private readonly config: Required<VASTParserConfig>;
  private readonly xmlParser: XMLParser;

  constructor(config: VASTParserConfig = {}) {
    this.config = {
      maxWrapperDepth: config.maxWrapperDepth ?? 5,
      timeout: config.timeout ?? 10000,
      debug: config.debug ?? false,
      fetchFn: config.fetchFn ?? fetch.bind(globalThis)
    };

    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      trimValues: true
    });
  }

  /**
   * Parse a VAST URL and resolve all wrappers
   * @param vastUrl - URL to the VAST document
   */
  async parse(vastUrl: string): Promise<ParseResult> {
    try {
      const response = await this.fetchAndParse(vastUrl, 0);
      return { success: true, response };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          code: VASTErrorCode.GENERAL_WRAPPER_ERROR,
          message
        }
      };
    }
  }

  /**
   * Fetch and parse VAST document with wrapper resolution
   */
  private async fetchAndParse(
    url: string,
    depth: number
  ): Promise<VASTResponse> {
    if (depth >= this.config.maxWrapperDepth) {
      throw new Error(
        `Wrapper limit exceeded (max: ${this.config.maxWrapperDepth})`
      );
    }

    this.log(`Fetching VAST (depth: ${depth}): ${url}`);

    const xml = await this.fetchWithTimeout(url);
    const parsed = this.parseXml(xml);
    
    // Resolve wrappers recursively
    const resolvedAds = await Promise.all(
      parsed.ads.map(async (ad) => {
        if (ad.wrapper?.vastAdTagURI) {
          return this.resolveWrapper(ad, depth + 1);
        }
        return ad;
      })
    );

    return {
      ...parsed,
      ads: resolvedAds.flat()
    };
  }

  /**
   * Resolve a wrapper ad by fetching the nested VAST
   */
  private async resolveWrapper(
    wrapperAd: Ad,
    depth: number
  ): Promise<Ad[]> {
    if (!wrapperAd.wrapper?.vastAdTagURI) {
      return [wrapperAd];
    }

    try {
      const nestedResponse = await this.fetchAndParse(
        wrapperAd.wrapper.vastAdTagURI,
        depth
      );

      // Merge wrapper tracking with nested ads
      return nestedResponse.ads.map((ad) =>
        this.mergeWrapperTracking(wrapperAd, ad)
      );
    } catch (error) {
      this.log(`Wrapper resolution failed: ${error}`);
      
      // Check fallback policy
      if (wrapperAd.wrapper.fallbackOnNoAd) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Merge tracking events from wrapper into nested ad
   */
  private mergeWrapperTracking(wrapper: Ad, nested: Ad): Ad {
    return {
      ...nested,
      impressions: [
        ...wrapper.impressions,
        ...nested.impressions
      ],
      errors: [...wrapper.errors, ...nested.errors],
      creatives: nested.creatives.map((creative) => ({
        ...creative,
        linear: creative.linear
          ? {
              ...creative.linear,
              trackingEvents: [
                ...this.getWrapperTrackingEvents(wrapper),
                ...creative.linear.trackingEvents
              ]
            }
          : undefined
      }))
    };
  }

  /**
   * Extract tracking events from wrapper creatives
   */
  private getWrapperTrackingEvents(wrapper: Ad): TrackingEvent[] {
    const events: TrackingEvent[] = [];
    
    for (const creative of wrapper.creatives) {
      if (creative.linear?.trackingEvents) {
        events.push(...creative.linear.trackingEvents);
      }
    }
    
    return events;
  }

  /**
   * Fetch URL with timeout
   */
  private async fetchWithTimeout(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout
    );

    try {
      const response = await this.config.fetchFn(url, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse raw VAST XML into structured response
   */
  private parseXml(xml: string): VASTResponse {
    const doc = this.xmlParser.parse(xml);
    const vast = doc.VAST;

    if (!vast) {
      throw new Error('Invalid VAST: missing VAST element');
    }

    const version = vast['@_version'] || '4.0';
    const ads = this.parseAds(vast.Ad);

    return {
      version,
      ads,
      errors: this.parseErrors(vast.Error)
    };
  }

  /**
   * Parse Ad elements
   */
  private parseAds(adElements: unknown): Ad[] {
    if (!adElements) return [];
    
    const ads = Array.isArray(adElements) ? adElements : [adElements];
    return ads.map((ad) => this.parseAd(ad));
  }

  /**
   * Parse a single Ad element
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseAd(ad: any): Ad {
    const isWrapper = !!ad.Wrapper;
    const content = ad.InLine || ad.Wrapper;

    return {
      id: ad['@_id'] || '',
      sequence: ad['@_sequence'],
      adSystem: content?.AdSystem
        ? { 
            name: typeof content.AdSystem === 'string' 
              ? content.AdSystem 
              : content.AdSystem['#text'] || '',
            version: content.AdSystem?.['@_version']
          }
        : undefined,
      adTitle: content?.AdTitle,
      impressions: this.parseImpressions(content?.Impression),
      errors: this.parseErrors(content?.Error),
      creatives: this.parseCreatives(content?.Creatives?.Creative),
      wrapper: isWrapper
        ? {
            vastAdTagURI: content.VASTAdTagURI,
            followAdditionalWrappers: content['@_followAdditionalWrappers'] !== false,
            allowMultipleAds: content['@_allowMultipleAds'],
            fallbackOnNoAd: content['@_fallbackOnNoAd']
          }
        : undefined,
      inLine: !isWrapper
        ? {
            adTitle: content?.AdTitle || '',
            description: content?.Description,
            advertiser: content?.Advertiser,
            creatives: this.parseCreatives(content?.Creatives?.Creative)
          }
        : undefined
    };
  }

  /**
   * Parse Impression elements
   */
  private parseImpressions(impressions: unknown): Impression[] {
    if (!impressions) return [];
    
    const list = Array.isArray(impressions) ? impressions : [impressions];
    return list.map((imp) => ({
      id: imp['@_id'],
      url: typeof imp === 'string' ? imp : imp['#text'] || ''
    }));
  }

  /**
   * Parse Creative elements
   */
  private parseCreatives(creatives: unknown): Creative[] {
    if (!creatives) return [];
    
    const list = Array.isArray(creatives) ? creatives : [creatives];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return list.map((c: any) => ({
      id: c['@_id'],
      sequence: c['@_sequence'],
      adId: c['@_adId'],
      linear: c.Linear ? this.parseLinear(c.Linear) : undefined
    }));
  }

  /**
   * Parse Linear element
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseLinear(linear: any): Linear {
    return {
      duration: this.parseDuration(linear.Duration),
      skipOffset: linear['@_skipoffset']
        ? this.parseDuration(linear['@_skipoffset'])
        : undefined,
      mediaFiles: this.parseMediaFiles(linear.MediaFiles?.MediaFile),
      trackingEvents: this.parseTrackingEvents(
        linear.TrackingEvents?.Tracking
      ),
      videoClicks: linear.VideoClicks
        ? {
            clickThrough: linear.VideoClicks.ClickThrough
              ? {
                  id: linear.VideoClicks.ClickThrough['@_id'],
                  url: typeof linear.VideoClicks.ClickThrough === 'string'
                    ? linear.VideoClicks.ClickThrough
                    : linear.VideoClicks.ClickThrough['#text'] || ''
                }
              : undefined
          }
        : undefined,
      adParameters: linear.AdParameters
    };
  }

  /**
   * Parse MediaFile elements
   */
  private parseMediaFiles(mediaFiles: unknown): MediaFile[] {
    if (!mediaFiles) return [];
    
    const list = Array.isArray(mediaFiles) ? mediaFiles : [mediaFiles];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return list.map((mf: any) => ({
      id: mf['@_id'],
      url: typeof mf === 'string' ? mf : mf['#text'] || '',
      delivery: mf['@_delivery'] || 'progressive',
      type: mf['@_type'] || 'video/mp4',
      width: parseInt(mf['@_width'], 10) || 0,
      height: parseInt(mf['@_height'], 10) || 0,
      bitrate: mf['@_bitrate'] ? parseInt(mf['@_bitrate'], 10) : undefined,
      codec: mf['@_codec'],
      scalable: mf['@_scalable'],
      maintainAspectRatio: mf['@_maintainAspectRatio']
    }));
  }

  /**
   * Parse Tracking elements
   */
  private parseTrackingEvents(trackings: unknown): TrackingEvent[] {
    if (!trackings) return [];
    
    const list = Array.isArray(trackings) ? trackings : [trackings];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return list.map((t: any) => ({
      event: t['@_event'],
      url: typeof t === 'string' ? t : t['#text'] || '',
      offset: t['@_offset'] ? this.parseDuration(t['@_offset']) : undefined
    }));
  }

  /**
   * Parse Error elements
   */
  private parseErrors(errors: unknown): string[] {
    if (!errors) return [];
    
    const list = Array.isArray(errors) ? errors : [errors];
    return list.map((e) => (typeof e === 'string' ? e : e['#text'] || ''));
  }

  /**
   * Parse duration string (HH:MM:SS or seconds) to seconds
   */
  private parseDuration(duration: unknown): number {
    if (typeof duration === 'number') return duration;
    if (typeof duration !== 'string') return 0;

    // Handle percentage (for skipoffset)
    if (duration.endsWith('%')) {
      return parseFloat(duration) / 100;
    }

    // Handle HH:MM:SS.mmm format
    const match = duration.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const [, hours, minutes, seconds] = match;
      return (
        parseInt(hours, 10) * 3600 +
        parseInt(minutes, 10) * 60 +
        parseFloat(seconds)
      );
    }

    return parseFloat(duration) || 0;
  }

  /**
   * Select the best media file based on target bitrate
   * Prefers 1080p/720p over 4K for TV compatibility
   */
  selectBestMediaFile(
    mediaFiles: MediaFile[],
    targetBitrate = 2500
  ): MediaFile | null {
    if (mediaFiles.length === 0) return null;

    // Filter to MP4 only for maximum compatibility
    const mp4Files = mediaFiles.filter(
      (mf) => mf.type.includes('mp4') || mf.type.includes('video/mp4')
    );

    const candidates = mp4Files.length > 0 ? mp4Files : mediaFiles;

    // Sort by closeness to target bitrate, preferring lower resolution
    const sorted = [...candidates].sort((a, b) => {
      const aBitrate = a.bitrate || 0;
      const bBitrate = b.bitrate || 0;

      // Penalize 4K content (height > 1080)
      const aPenalty = a.height > 1080 ? 10000 : 0;
      const bPenalty = b.height > 1080 ? 10000 : 0;

      const aDiff = Math.abs(aBitrate - targetBitrate) + aPenalty;
      const bDiff = Math.abs(bBitrate - targetBitrate) + bPenalty;

      return aDiff - bDiff;
    });

    return sorted[0] || null;
  }

  /**
   * Aggregate all tracking events from parsed ads
   */
  aggregateTrackingEvents(ads: Ad[]): TrackingEvent[] {
    const events: TrackingEvent[] = [];

    for (const ad of ads) {
      for (const creative of ad.creatives) {
        if (creative.linear?.trackingEvents) {
          events.push(...creative.linear.trackingEvents);
        }
      }
    }

    return events;
  }

  /**
   * Get all impression URLs from parsed ads
   */
  aggregateImpressions(ads: Ad[]): string[] {
    const urls: string[] = [];

    for (const ad of ads) {
      for (const impression of ad.impressions) {
        urls.push(impression.url);
      }
    }

    return urls;
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[VASTParser] ${message}`);
    }
  }
}
