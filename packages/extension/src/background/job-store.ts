import { MAX_HISTORY_ITEMS, type HistoryItem, type Job } from '@ytdl/shared';
import { getHistory, getJobs } from '../lib/storage.js';

/**
 * All job state lives in chrome.storage.session (the service worker can be stopped at any time).
 * Writes are serialized through one promise chain so concurrent progress updates never lose data.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export function mutateJobs<T>(fn: (jobs: Record<string, Job>) => T): Promise<T> {
  return serialize(async () => {
    const jobs = await getJobs();
    const result = fn(jobs);
    await chrome.storage.session.set({ jobs });
    return result;
  });
}

/** Removes a finished job from the active table and records it in history. Returns the job, if it existed. */
export function finishJob(
  jobId: string,
  status: HistoryItem['status'],
  extra: { filePath?: string; error?: string },
): Promise<Job | undefined> {
  return serialize(async () => {
    const jobs = await getJobs();
    const job = jobs[jobId];
    if (!job) return undefined;
    delete jobs[jobId];
    const history = await getHistory();
    const item: HistoryItem = {
      jobId,
      videoId: job.videoId,
      title: job.title,
      mode: job.mode,
      label: job.label,
      status,
      finishedAt: Date.now(),
      ...(extra.filePath ? { filePath: extra.filePath } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    };
    await chrome.storage.session.set({ jobs });
    await chrome.storage.local.set({ history: [item, ...history].slice(0, MAX_HISTORY_ITEMS) });
    return job;
  });
}

export function activeJobCount(jobs: Record<string, Job>): number {
  return Object.values(jobs).filter((j) => j.status === 'queued' || j.status === 'running').length;
}
