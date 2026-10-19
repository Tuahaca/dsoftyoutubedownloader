import { HOST_NAME, isHostResponse, type ErrorCode, type HostRequest, type HostResponse, type UiError } from '@ytdl/shared';

type RequestBody = HostRequest extends infer R ? (R extends HostRequest ? Omit<R, 'id'> : never) : never;

interface Pending {
  resolve: (msg: HostResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

const IDLE_DISCONNECT_MS = 60_000;

/** Maps chrome.runtime.lastError after a native port drops to our error codes. */
export function mapDisconnectError(message: string | undefined): UiError {
  const m = (message ?? '').toLowerCase();
  let code: ErrorCode = 'HOST_DISCONNECTED';
  if (m.includes('not found')) code = 'HOST_MISSING';
  else if (m.includes('forbidden')) code = 'HOST_FORBIDDEN';
  return { code, message: message || 'Native host disconnected' };
}

/**
 * The only owner of the Native Messaging port. Request/response calls (hello, probe, reveal)
 * resolve on the first reply with the same id; everything else (download progress, done,
 * cancelled, errors for a job id) is routed to onJobMessage.
 */
export class NativeClient {
  private port: chrome.runtime.Port | null = null;
  private readonly pending = new Map<string, Pending>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onJobMessage: (msg: HostResponse) => void,
    private readonly onDisconnect: (error: UiError) => void,
    private readonly isBusy: () => boolean,
  ) {}

  get connected(): boolean {
    return this.port !== null;
  }

  /** Sends a message that expects exactly one reply. Never rejects: failures come back as type "error". */
  request(body: RequestBody, timeoutMs: number): Promise<HostResponse> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, type: 'error', code: 'NETWORK', message: 'The helper app did not answer in time' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      // If the host is unreachable, post() resolves this request with the disconnect error.
      this.post({ ...body, id } as HostRequest);
    });
  }

  /** Fire-and-forget; replies arrive through onJobMessage. Returns false if the host is unreachable. */
  post(message: HostRequest): boolean {
    this.clearIdle();
    try {
      this.ensurePort().postMessage(message);
      return true;
    } catch (error) {
      this.handleDisconnect(mapDisconnectError(error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  /** Lets the service worker sleep when nothing is happening (an open port keeps it alive). */
  scheduleIdleDisconnect(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      if (this.port && this.pending.size === 0 && !this.isBusy()) {
        this.port.disconnect();
        this.port = null;
      }
    }, IDLE_DISCONNECT_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private ensurePort(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((raw: unknown) => this.handleMessage(raw));
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      this.handleDisconnect(mapDisconnectError(chrome.runtime.lastError?.message));
    });
    this.port = port;
    return port;
  }

  private handleMessage(raw: unknown): void {
    if (!isHostResponse(raw)) {
      console.warn('Ignoring malformed host message', raw);
      return;
    }
    const pending = this.pending.get(raw.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(raw.id);
      pending.resolve(raw);
    } else {
      this.onJobMessage(raw);
    }
    if (this.pending.size === 0 && !this.isBusy()) this.scheduleIdleDisconnect();
  }

  private handleDisconnect(error: UiError): void {
    this.port = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ id, type: 'error', code: error.code, message: error.message });
    }
    this.pending.clear();
    this.onDisconnect(error);
  }
}
