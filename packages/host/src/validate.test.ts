import { describe, expect, it } from 'vitest';
import { isInsideDir, validateRequest } from './validate.js';

const ID = 'abcdefghijk';

describe('validateRequest', () => {
  it('canonicalizes the URL and extracts the id', () => {
    const r = validateRequest({ id: '1', type: 'probe', url: `https://youtu.be/${ID}?si=tracking` });
    expect(r).toEqual({ ok: true, value: { id: '1', type: 'probe', url: `https://www.youtube.com/watch?v=${ID}`, videoId: ID } });
  });

  it('rejects non-YouTube URLs', () => {
    const r = validateRequest({ id: '1', type: 'download', url: 'https://example.com/v.mp4', mode: 'video' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_URL' });
  });

  it('rejects relative output folders', () => {
    const r = validateRequest({ id: '1', type: 'download', url: `https://youtu.be/${ID}`, mode: 'video', outputDir: '..\\..\\Windows' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('rejects malformed messages', () => {
    expect(validateRequest({ type: 'hello' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(validateRequest('hello')).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('rejects relative reveal paths', () => {
    expect(validateRequest({ id: '1', type: 'reveal', filePath: 'a.mp4' })).toMatchObject({ ok: false });
  });
});

describe('isInsideDir', () => {
  const base = process.platform === 'win32' ? 'C:\\Users\\me\\Downloads\\YouTube' : '/home/me/Downloads/YouTube';
  const sep = process.platform === 'win32' ? '\\' : '/';

  it('accepts files in the folder', () => {
    expect(isInsideDir(base, `${base}${sep}a [x].mp4`)).toBe(true);
    expect(isInsideDir(base, base)).toBe(true);
  });

  it('rejects escapes', () => {
    expect(isInsideDir(base, `${base}${sep}..${sep}evil.exe`)).toBe(false);
    expect(isInsideDir(base, `${base}-other${sep}a.mp4`)).toBe(false);
  });
});
