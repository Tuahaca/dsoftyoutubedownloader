import type { UiRequest, UiResponse } from '@ytdl/shared';

/** Popup/options → service worker. Never rejects; transport failures come back as ok:false. */
export async function ask<T>(req: UiRequest): Promise<UiResponse<T>> {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as UiResponse<T> | undefined;
    return res ?? { ok: false, error: { code: 'UNKNOWN', message: 'No response from the extension' } };
  } catch (error) {
    return { ok: false, error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } };
  }
}
