import { describe, expect, it } from 'vitest';
import { mapDisconnectError } from './native.js';

describe('mapDisconnectError', () => {
  it('maps Chrome lastError messages to setup codes', () => {
    expect(mapDisconnectError('Specified native messaging host not found.').code).toBe('HOST_MISSING');
    expect(mapDisconnectError('Access to the specified native messaging host is forbidden.').code).toBe('HOST_FORBIDDEN');
    expect(mapDisconnectError('Native host has exited.').code).toBe('HOST_DISCONNECTED');
    expect(mapDisconnectError(undefined)).toEqual({ code: 'HOST_DISCONNECTED', message: 'Native host disconnected' });
  });
});
