import './popup.css';
import {
  AUDIO_FORMATS,
  canonicalWatchUrl,
  formatDuration,
  formatEta,
  formatSpeed,
  parseYouTubeVideoId,
  README_URL,
  type AudioFormat,
  type ErrorCode,
  type HistoryItem,
  type Job,
  type Mode,
  type Settings,
  type UiError,
  type VideoInfo,
} from '@ytdl/shared';
import { $, h } from '../lib/dom.js';
import { ask } from '../lib/messaging.js';
import { getHistory, getJobs, getSettings, parseHistory, parseJobs } from '../lib/storage.js';
import { pickDefaultHeight } from './quality.js';

const SETUP_ERRORS: ReadonlySet<ErrorCode> = new Set(['HOST_MISSING', 'HOST_FORBIDDEN', 'DEPENDENCY_MISSING']);

const main = $('#main');
let settings: Settings;
let videoId: string | null = null;
let info: VideoInfo | null = null;
let mode: Mode = 'video';
let height: number | undefined;
let audioFormat: AudioFormat = 'mp3';
let jobs: Record<string, Job> = {};

// ---------- main panel states ----------

function show(...nodes: Node[]): void {
  main.replaceChildren(...nodes);
}

function showLoading(): void {
  show(
    h(
      'div',
      { class: 'skeleton', 'aria-label': 'Loading video info' },
      h('div', { class: 'thumb' }),
      h('div', { class: 'lines' }, h('div'), h('div', { style: 'width:60%' })),
    ),
  );
}

function showNotYouTube(): void {
  show(h('div', { class: 'state' }, h('p', {}, 'Open a YouTube video to download it.')));
}

function showError(error: UiError): void {
  if (SETUP_ERRORS.has(error.code)) {
    show(
      h(
        'div',
        { class: 'state' },
        h('p', { class: 'error-text' }, error.message),
        h('p', { class: 'muted' }, 'The helper app, yt-dlp and ffmpeg must be installed once.'),
        h('button', { class: 'btn', type: 'button', onclick: () => void chrome.tabs.create({ url: README_URL }) }, 'Open setup guide'),
      ),
    );
    return;
  }
  show(
    h(
      'div',
      { class: 'state' },
      h('p', { class: 'error-text' }, error.message),
      h('button', { class: 'btn', type: 'button', onclick: () => void loadVideo() }, 'Try again'),
    ),
  );
}

function showVideo(v: VideoInfo): void {
  const meta = [v.channel, formatDuration(v.durationSec)].filter(Boolean).join(' · ');
  const card = h(
    'div',
    { class: 'video' },
    v.thumbnailUrl ? h('img', { src: v.thumbnailUrl, alt: '' }) : h('img', { alt: '' }),
    h('div', {}, h('p', { class: 'title', title: v.title }, v.title), h('div', { class: 'muted' }, meta)),
  );

  const qualitySelect = h('select', { 'aria-label': 'Quality' });
  const renderOptions = () => {
    qualitySelect.replaceChildren();
    if (mode === 'video') {
      if (v.heights.length === 0) qualitySelect.append(h('option', { value: '' }, 'Best available'));
      for (const hgt of v.heights) {
        qualitySelect.append(h('option', { value: String(hgt), selected: hgt === height }, `${hgt}p MP4`));
      }
    } else {
      for (const f of AUDIO_FORMATS) {
        const label = f === 'mp3' ? 'MP3 (best quality)' : 'M4A (original, no re-encode)';
        qualitySelect.append(h('option', { value: f, selected: f === audioFormat }, label));
      }
    }
  };
  qualitySelect.addEventListener('change', () => {
    if (mode === 'video') height = qualitySelect.value ? Number(qualitySelect.value) : undefined;
    else audioFormat = qualitySelect.value === 'm4a' ? 'm4a' : 'mp3';
  });

  const videoBtn = h('button', { type: 'button' }, 'Video');
  const audioBtn = h('button', { type: 'button' }, 'Audio');
  const setMode = (m: Mode) => {
    mode = m;
    videoBtn.setAttribute('aria-pressed', String(m === 'video'));
    audioBtn.setAttribute('aria-pressed', String(m === 'audio'));
    renderOptions();
  };
  videoBtn.addEventListener('click', () => setMode('video'));
  audioBtn.addEventListener('click', () => setMode('audio'));

  const downloadBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Download');
  const errorLine = h('p', { class: 'error-text', hidden: true });
  downloadBtn.addEventListener('click', () => {
    void (async () => {
      downloadBtn.disabled = true;
      errorLine.hidden = true;
      const res = await ask<{ jobId: string }>({
        kind: 'download',
        url: canonicalWatchUrl(v.videoId),
        videoId: v.videoId,
        title: v.title,
        mode,
        ...(mode === 'video' && height ? { height } : {}),
        ...(mode === 'audio' ? { audioFormat } : {}),
      });
      downloadBtn.disabled = false;
      if (!res.ok) {
        errorLine.textContent = res.error.message;
        errorLine.hidden = false;
      }
    })();
  });

  setMode(mode);
  show(
    card,
    h(
      'div',
      { class: 'picker' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Format' }, videoBtn, audioBtn),
      h('div', { class: 'row' }, qualitySelect, downloadBtn),
      errorLine,
    ),
  );
}

async function loadVideo(): Promise<void> {
  if (!videoId) return showNotYouTube();
  showLoading();
  const res = await ask<VideoInfo>({ kind: 'probe', url: canonicalWatchUrl(videoId) });
  if (!res.ok) return showError(res.error);
  info = res.data;
  height = pickDefaultHeight(info.heights, settings.defaultHeight);
  showVideo(info);
}

// ---------- jobs & history ----------

function stageText(job: Job): string {
  if (job.status === 'queued') return 'Waiting…';
  if (job.stage === 'merging') return 'Merging video and audio…';
  if (job.stage === 'converting') return 'Converting audio…';
  return [`${job.percent.toFixed(1)}%`, formatSpeed(job.speed), formatEta(job.etaSec)].filter(Boolean).join(' · ');
}

function renderJobs(): void {
  const list = $('#jobs');
  const active = Object.values(jobs).sort((a, b) => a.startedAt - b.startedAt);
  $('#jobs-section').hidden = active.length === 0;
  list.replaceChildren(
    ...active.map((job) => {
      const indeterminate = job.status === 'queued' || job.stage === 'merging' || job.stage === 'converting';
      const bar = h('div', { style: `width:${Math.max(2, job.percent)}%` });
      return h(
        'li',
        { class: 'item' },
        h('div', { class: 'item-head' }, h('span', { class: 'item-title', title: job.title }, job.title), h('span', { class: 'tag' }, job.label)),
        h('div', { class: indeterminate ? 'progress indeterminate' : 'progress', role: 'progressbar', 'aria-valuenow': Math.round(job.percent), 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
        h(
          'div',
          { class: 'item-meta' },
          h('span', {}, stageText(job)),
          h('button', { class: 'btn-link', type: 'button', onclick: () => void ask({ kind: 'cancel', jobId: job.jobId }) }, 'Cancel'),
        ),
      );
    }),
  );
}

function renderHistory(history: HistoryItem[]): void {
  const list = $('#history');
  $('#history-section').hidden = history.length === 0;
  list.replaceChildren(
    ...history.map((item) => {
      let right: Node;
      if (item.status === 'done' && item.filePath) {
        const filePath = item.filePath;
        right = h('button', { class: 'btn-link', type: 'button', onclick: () => void reveal(filePath) }, 'Show in folder');
      } else if (item.status === 'failed') {
        right = h('span', { class: 'status-failed', title: item.error ?? '' }, 'Failed');
      } else {
        right = h('span', { class: 'muted' }, 'Cancelled');
      }
      return h(
        'li',
        { class: 'item' },
        h('div', { class: 'item-head' }, h('span', { class: 'item-title', title: item.title }, item.title), h('span', { class: 'tag' }, item.label)),
        h(
          'div',
          { class: 'item-meta' },
          h('span', { class: item.status === 'failed' ? 'status-failed' : '' }, item.status === 'failed' ? (item.error ?? '') : new Date(item.finishedAt).toLocaleString()),
          right,
        ),
      );
    }),
  );
}

async function reveal(filePath: string): Promise<void> {
  const res = await ask({ kind: 'reveal', filePath });
  if (!res.ok) alert(res.error.message);
}

// ---------- boot ----------

async function init(): Promise<void> {
  $('#open-options').addEventListener('click', () => void chrome.runtime.openOptionsPage());
  void ask({ kind: 'popupOpened' });

  settings = await getSettings();
  mode = settings.defaultMode;
  audioFormat = settings.audioFormat;

  jobs = await getJobs();
  renderJobs();
  renderHistory(await getHistory());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.jobs) {
      jobs = parseJobs(changes.jobs.newValue);
      renderJobs();
    }
    if (area === 'local' && changes.history) renderHistory(parseHistory(changes.history.newValue));
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  videoId = tab?.url ? parseYouTubeVideoId(tab.url) : null;
  await loadVideo();
}

void init();
