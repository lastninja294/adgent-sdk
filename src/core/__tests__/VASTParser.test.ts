/**
 * VASTParser Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VASTParser } from '@/core/VASTParser';
import { MediaFile } from '@/types/vast';

// Sample VAST XML responses for testing
const SIMPLE_VAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.0">
  <Ad id="12345">
    <InLine>
      <AdSystem version="1.0">Test Ad Server</AdSystem>
      <AdTitle>Test Ad</AdTitle>
      <Impression id="imp1">https://example.com/impression</Impression>
      <Creatives>
        <Creative id="creative1">
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080" bitrate="2500">
                https://example.com/video.mp4
              </MediaFile>
            </MediaFiles>
            <TrackingEvents>
              <Tracking event="start">https://example.com/start</Tracking>
              <Tracking event="complete">https://example.com/complete</Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

const WRAPPER_VAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.0">
  <Ad id="wrapper1">
    <Wrapper>
      <AdSystem>Wrapper Ad Server</AdSystem>
      <VASTAdTagURI>https://example.com/inline-vast.xml</VASTAdTagURI>
      <Impression>https://example.com/wrapper-impression</Impression>
      <Creatives>
        <Creative>
          <Linear>
            <TrackingEvents>
              <Tracking event="start">https://example.com/wrapper-start</Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
      </Creatives>
    </Wrapper>
  </Ad>
</VAST>`;



const EMPTY_VAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.0">
</VAST>`;

describe('VASTParser', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parse', () => {
    it('should parse simple inline VAST', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.success).toBe(true);
      expect(result.response?.ads).toHaveLength(1);
      expect(result.response?.ads[0].id).toBe(12345); // Parser returns number due to parseAttributeValue
      expect(result.response?.ads[0].adTitle).toBe('Test Ad');
    });

    it('should extract impressions', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.response?.ads[0].impressions).toHaveLength(1);
      expect(result.response?.ads[0].impressions[0].url).toBe('https://example.com/impression');
    });

    it('should extract media files', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      const linear = result.response?.ads[0].creatives[0].linear;
      expect(linear?.mediaFiles).toHaveLength(1);
      expect(linear?.mediaFiles[0].width).toBe(1920);
      expect(linear?.mediaFiles[0].height).toBe(1080);
      expect(linear?.mediaFiles[0].bitrate).toBe(2500);
    });

    it('should extract tracking events', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      const linear = result.response?.ads[0].creatives[0].linear;
      expect(linear?.trackingEvents).toHaveLength(2);
      expect(linear?.trackingEvents[0].event).toBe('start');
      expect(linear?.trackingEvents[1].event).toBe('complete');
    });

    it('should parse duration correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      const linear = result.response?.ads[0].creatives[0].linear;
      expect(linear?.duration).toBe(30); // 00:00:30 = 30 seconds
    });

    it('should handle empty VAST response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(EMPTY_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.success).toBe(true);
      expect(result.response?.ads).toHaveLength(0);
    });

    it('should handle fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Network error');
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('404');
    });

    it('should handle invalid XML', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('not valid xml')
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.success).toBe(false);
    });
  });

  describe('Wrapper Resolution', () => {
    it('should resolve wrapper to inline VAST', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(WRAPPER_VAST)
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(SIMPLE_VAST)
        });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/wrapper.xml');

      expect(result.success).toBe(true);
      // Should have fetched twice - wrapper + inline
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should merge wrapper tracking events', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(WRAPPER_VAST)
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(SIMPLE_VAST)
        });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/wrapper.xml');

      // Should have wrapper impressions merged
      const impressions = parser.aggregateImpressions(result.response!.ads);
      expect(impressions).toContain('https://example.com/wrapper-impression');
      expect(impressions).toContain('https://example.com/impression');
    });

    it('should respect maxWrapperDepth', async () => {
      // Create a chain that exceeds the limit
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(WRAPPER_VAST)
      });

      const parser = new VASTParser({ maxWrapperDepth: 2 });
      const result = await parser.parse('https://example.com/wrapper.xml');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Wrapper limit exceeded');
    });
  });

  describe('selectBestMediaFile', () => {
    const createMediaFile = (
      width: number,
      height: number,
      bitrate: number,
      type = 'video/mp4'
    ): MediaFile => ({
      url: `https://example.com/${width}x${height}.mp4`,
      delivery: 'progressive',
      type,
      width,
      height,
      bitrate
    });

    it('should prefer MP4 over other formats', () => {
      const parser = new VASTParser();
      const mediaFiles: MediaFile[] = [
        createMediaFile(1920, 1080, 2500, 'video/webm'),
        createMediaFile(1920, 1080, 2500, 'video/mp4')
      ];

      const best = parser.selectBestMediaFile(mediaFiles, 2500);
      expect(best?.type).toBe('video/mp4');
    });

    it('should prefer 1080p over 4K', () => {
      const parser = new VASTParser();
      const mediaFiles: MediaFile[] = [
        createMediaFile(3840, 2160, 8000),
        createMediaFile(1920, 1080, 2500),
        createMediaFile(1280, 720, 1500)
      ];

      const best = parser.selectBestMediaFile(mediaFiles, 2500);
      expect(best?.height).toBe(1080);
    });

    it('should select closest to target bitrate', () => {
      const parser = new VASTParser();
      const mediaFiles: MediaFile[] = [
        createMediaFile(1920, 1080, 5000),
        createMediaFile(1920, 1080, 2500),
        createMediaFile(1920, 1080, 1000)
      ];

      const best = parser.selectBestMediaFile(mediaFiles, 2500);
      expect(best?.bitrate).toBe(2500);
    });

    it('should handle empty media files array', () => {
      const parser = new VASTParser();
      const best = parser.selectBestMediaFile([], 2500);
      expect(best).toBeNull();
    });

    it('should fallback to non-MP4 if no MP4 available', () => {
      const parser = new VASTParser();
      const mediaFiles: MediaFile[] = [
        createMediaFile(1920, 1080, 2500, 'video/webm')
      ];

      const best = parser.selectBestMediaFile(mediaFiles, 2500);
      expect(best?.type).toBe('video/webm');
    });
  });

  describe('aggregateTrackingEvents', () => {
    it('should aggregate all tracking events from ads', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');
      const events = parser.aggregateTrackingEvents(result.response!.ads);

      expect(events).toHaveLength(2);
      expect(events.map(e => e.event)).toContain('start');
      expect(events.map(e => e.event)).toContain('complete');
    });
  });

  describe('aggregateImpressions', () => {
    it('should aggregate all impression URLs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SIMPLE_VAST)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');
      const impressions = parser.aggregateImpressions(result.response!.ads);

      expect(impressions).toHaveLength(1);
      expect(impressions[0]).toBe('https://example.com/impression');
    });
  });

  describe('Duration Parsing', () => {
    it('should parse HH:MM:SS format', async () => {
      const vastWithDuration = SIMPLE_VAST.replace(
        '00:00:30',
        '01:30:45'
      );
      
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(vastWithDuration)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');
      const linear = result.response?.ads[0].creatives[0].linear;

      // 1 hour + 30 minutes + 45 seconds = 5445 seconds
      expect(linear?.duration).toBe(5445);
    });

    it('should parse HH:MM:SS.mmm format', async () => {
      const vastWithDuration = SIMPLE_VAST.replace(
        '00:00:30',
        '00:00:30.500'
      );
      
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(vastWithDuration)
      });

      const parser = new VASTParser();
      const result = await parser.parse('https://example.com/vast.xml');
      const linear = result.response?.ads[0].creatives[0].linear;

      expect(linear?.duration).toBe(30.5);
    });
  });

  describe('Timeout', () => {
    it('should respect timeout configuration', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      
      mockFetch.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(abortError), 100);
      }));

      const parser = new VASTParser({ timeout: 50 });
      const result = await parser.parse('https://example.com/vast.xml');

      expect(result.success).toBe(false);
    });
  });
});
