import { describe, expect, it } from 'vitest';
import { decodeVideoId, encodeVideoId, resolveVideo } from './sources.js';

describe('sources', () => {
  it('encodes and decodes video id for inbox source', () => {
    const id = encodeVideoId('inbox', 'Urlaub 2026.mp4');
    expect(id).toMatch(/^inbox:/);
    const decoded = decodeVideoId(id);
    expect(decoded).toEqual({ source: 'inbox', relPath: 'Urlaub 2026.mp4' });
  });

  it('accepts legacy bare filename as inbox fallback', () => {
    const decoded = decodeVideoId('Mein Video.mov');
    expect(decoded).toEqual({ source: 'inbox', relPath: 'Mein Video.mov' });
  });

  it('rejects path traversal attempts in resolveVideo', () => {
    expect(resolveVideo('../etc/passwd')).toBeNull();
    expect(resolveVideo('inbox:' + Buffer.from('../../secret.mp4').toString('base64url'))).toBeNull();
    expect(resolveVideo('inbox:' + Buffer.from('/root/video.mp4').toString('base64url'))).toBeNull();
  });

  it('rejects unsupported extensions', () => {
    expect(resolveVideo('script.sh')).toBeNull();
    expect(resolveVideo('inbox:' + Buffer.from('malware.exe').toString('base64url'))).toBeNull();
  });
});
