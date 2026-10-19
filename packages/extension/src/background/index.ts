import {
  canonicalWatchUrl,
  FRIENDLY_ERRORS,
  isUiRequest,
  parseYouTubeVideoId,
  qualityLabel,
  type HostResponse,
  type Job,
  type UiError,
  type UiRequest,
  type UiResponse,
} from '@ytdl/shared';
import { getHistory, getJobs, getSettings } from '../lib/storage.js';
import { activeJobCount, finishJob, mutateJobs } from './job-store.js';
import { NativeClient } from './native.js';

// Mirror of the active job count, kept in memory only so NativeClient.isBusy() can be synchronous.
let busyCount = 0;

const native = new NativeClient(handleJobMessage, handleDisconnect, () => busyCount > 0);

// ---------- badge & notifications ----------

async function refreshBadge(): Promise<void> {
  const jobs = await getJobs();
  busyCount = activeJobCount(jobs);
  const { badgeError } = await chrome.storage.session.get('badgeError');
  if (busyCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
    await chrome.action.setBadgeText({ text: String(busyCount) });
  } else if (badgeError === true) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    await chrome.action.setBadgeText({ text: '!' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

function notify(jobId: string, title: string, message: string): void {
  chrome.notifications.create(jobId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  void (async () => {
    const item = (await getHistory()).find((h) => h.jobId === notificationId);
    if (item?.filePath) await native.request({ type: 'reveal', filePath: item.filePath }, 10_000);
    chrome.notifications.clear(notificationId);
  })();
});

// ---------- host → job updates ----------

function handleJobMessage(msg: HostResponse): void {
  void (async () => {
    switch (msg.type) {
      case 'progress':
        await mutateJobs((jobs) => {
          const job = jobs[msg.id];
          if (!job) return;
          job.status = 'running';
          job.percent = msg.percent;
          job.stage = msg.stage;
          job.speed = msg.speed;
          job.etaSec = msg.etaSec;
        });
        break;
      case 'done': {
        const job = await finishJob(msg.id, 'done', { filePath: msg.filePath });
        if (job) notify(msg.id, 'Download complete', `${job.title} (${job.label})`);
        break;
      }
      case 'cancelled':
        await finishJob(msg.id, 'cancelled', {});
        break;
      case 'error': {
        const message = FRIENDLY_ERRORS[msg.code] ?? msg.message;
        const job = await finishJob(msg.id, 'failed', { error: message });
        if (job) {
          await chrome.storage.session.set({ badgeError: true });
          notify(msg.id, 'Download failed', `${job.title}: ${message}`);
        }
        break;
      }
      default:
        return;
    }
    await refreshBadge();
    if (busyCount === 0) native.scheduleIdleDisconnect();
  })();
}

function handleDisconnect(error: UiError): void {
  void failAllActive(error);
}

/** Port dropped (or the worker restarted): the host has killed its downloads, so mark ours failed. */
async function failAllActive(error: UiError): Promise<void> {
  const jobs = await getJobs();
  const active = Object.values(jobs).filter((j) => j.status === 'queued' || j.status === 'running');
  for (const job of active) {
    await finishJob(job.jobId, 'failed', { error: FRIENDLY_ERRORS[error.code] ?? error.message });
  }
  if (active.length > 0) await chrome.storage.session.set({ badgeError: true });
  await refreshBadge();
}

// ---------- popup/options requests ----------

const fail = (error: UiError): UiResponse<never> => ({ ok: false, error });
const fromHostError = (msg: HostResponse): UiResponse<never> =>
  msg.type === 'error'
    ? fail({ code: msg.code, message: FRIENDLY_ERRORS[msg.code] ?? msg.message })
    : fail({ code: 'UNKNOWN', message: `Unexpected reply: ${msg.type}` });

async function handleUiRequest(req: UiRequest): Promise<UiResponse> {
  switch (req.kind) {
    case 'hello': {
      const res = await native.request({ type: 'hello' }, 20_000);
      return res.type === 'hello' ? { ok: true, data: res } : fromHostError(res);
    }
    case 'probe': {
      const res = await native.request({ type: 'probe', url: req.url }, 90_000);
      return res.type === 'info' ? { ok: true, data: res } : fromHostError(res);
    }
    case 'download': {
      const videoId = parseYouTubeVideoId(req.url);
      if (!videoId) return fail({ code: 'INVALID_URL', message: FRIENDLY_ERRORS.INVALID_URL });
      const settings = await getSettings();
      const jobId = crypto.randomUUID();
      const job: Job = {
        jobId,
        videoId,
        title: req.title || videoId,
        mode: req.mode,
        label: qualityLabel(req.mode, req.height, req.audioFormat),
        status: 'queued',
        percent: 0,
        startedAt: Date.now(),
      };
      await mutateJobs((jobs) => {
        jobs[jobId] = job;
      });
      busyCount++;
      await chrome.storage.session.set({ badgeError: false });
      await refreshBadge();
      native.post({
        id: jobId,
        type: 'download',
        url: canonicalWatchUrl(videoId),
        mode: req.mode,
        ...(req.mode === 'video' && req.height ? { height: req.height } : {}),
        ...(req.mode === 'audio' ? { audioFormat: req.audioFormat ?? settings.audioFormat } : {}),
        ...(settings.outputDir ? { outputDir: settings.outputDir } : {}),
        maxConcurrent: settings.maxConcurrent,
      });
      return { ok: true, data: { jobId } };
    }
    case 'cancel': {
      if (native.connected) {
        native.post({ id: crypto.randomUUID(), type: 'cancel', jobId: req.jobId });
      } else {
        await finishJob(req.jobId, 'cancelled', {});
        await refreshBadge();
      }
      return { ok: true, data: null };
    }
    case 'reveal': {
      const res = await native.request({ type: 'reveal', filePath: req.filePath }, 10_000);
      return res.type === 'revealed' ? { ok: true, data: null } : fromHostError(res);
    }
    case 'popupOpened':
      await chrome.storage.session.set({ badgeError: false });
      await refreshBadge();
      return { ok: true, data: null };
  }
}

// On worker start nothing is connected yet, so any job still marked active was interrupted.
const ready = failAllActive({ code: 'HOST_DISCONNECTED', message: 'Interrupted' });

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!isUiRequest(message)) {
    sendResponse(fail({ code: 'INVALID_REQUEST', message: 'Unknown request' }));
    return false;
  }
  ready
    .then(() => handleUiRequest(message))
    .then(sendResponse, (error: unknown) =>
      sendResponse(fail({ code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) })),
    );
  return true; // keep the channel open for the async response
});
