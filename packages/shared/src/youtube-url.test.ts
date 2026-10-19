import { describe, expect, it } from 'vitest';
import { canonicalWatchUrl, isValidVideoId, parseYouTubeVideoId } from './youtube-url.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeVideoId', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])('accepts %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBe(ID);
  });

  it.each([
    'not a url',
    '',
    `ftp://www.youtube.com/watch?v=${ID}`,
    `javascript:alert(1)//www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com.evil.com/watch?v=${ID}`,
    `https://evil.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://user:pass@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8080/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ;rm',
    'https://www.youtube.com/watch?v=--exec=calc',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/',
    `https://www.youtube.com/shorts/${ID}/extra`,
  ])('rejects %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull();
  });
});

describe('canonicalWatchUrl', () => {
  it('builds a watch URL from a valid id', () => {
    expect(canonicalWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('throws on an invalid id', () => {
    expect(() => canonicalWatchUrl('--exec=calc')).toThrow();
  });
});

describe('isValidVideoId', () => {
  it('requires exactly 11 URL-safe base64 characters', () => {
    expect(isValidVideoId('abcdefghij_')).toBe(true);
    expect(isValidVideoId('abc-efghij1')).toBe(true);
    expect(isValidVideoId('abcdefghij')).toBe(false);
    expect(isValidVideoId('abcdefghij12')).toBe(false);
    expect(isValidVideoId('abcdefghij!')).toBe(false);
  });
});
