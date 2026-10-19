import { isHistoryItem, isJob, normalizeSettings, type HistoryItem, type Job, type Settings } from '@ytdl/shared';

/**
 * Typed access to chrome.storage. Everything read from storage is validated: storage can hold
 * data from older versions of the extension.
 *   local.settings  – Settings
 *   local.history   – HistoryItem[] (newest first, max 20)
 *   session.jobs    – Record<jobId, Job> (active jobs only)
 *   session.badgeError – boolean (a job failed since the popup was last opened)
 */
export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: normalizeSettings(settings) });
}

export function parseJobs(raw: unknown): Record<string, Job> {
  const out: Record<string, Job> = {};
  if (raw && typeof raw === 'object') {
    for (const [id, job] of Object.entries(raw as Record<string, unknown>)) {
      if (isJob(job)) out[id] = job;
    }
  }
  return out;
}

export function parseHistory(raw: unknown): HistoryItem[] {
  return Array.isArray(raw) ? raw.filter(isHistoryItem) : [];
}

export async function getJobs(): Promise<Record<string, Job>> {
  const { jobs } = await chrome.storage.session.get('jobs');
  return parseJobs(jobs);
}

export async function getHistory(): Promise<HistoryItem[]> {
  const { history } = await chrome.storage.local.get('history');
  return parseHistory(history);
}
