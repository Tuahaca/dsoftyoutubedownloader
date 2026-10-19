import './options.css';
import {
  isAbsolutePathLike,
  isAudioFormat,
  isMaxConcurrent,
  isMode,
  QUALITY_PRESETS,
  README_URL,
  type HelloResponse,
  type Settings,
} from '@ytdl/shared';
import { $, h } from '../lib/dom.js';
import { ask } from '../lib/messaging.js';
import { getSettings, saveSettings } from '../lib/storage.js';

const input = <T extends HTMLElement>(id: string) => $(`#${id}`) as T;
const outputDir = input<HTMLInputElement>('outputDir');
const defaultMode = input<HTMLSelectElement>('defaultMode');
const defaultHeight = input<HTMLSelectElement>('defaultHeight');
const audioFormat = input<HTMLSelectElement>('audioFormat');
const maxConcurrent = input<HTMLSelectElement>('maxConcurrent');

function fill(s: Settings): void {
  outputDir.value = s.outputDir;
  defaultMode.value = s.defaultMode;
  defaultHeight.value = String(s.defaultHeight);
  audioFormat.value = s.audioFormat;
  maxConcurrent.value = String(s.maxConcurrent);
}

function readForm(): Settings | null {
  const dir = outputDir.value.trim();
  const dirOk = dir === '' || isAbsolutePathLike(dir);
  $('#outputDir-error').hidden = dirOk;
  if (!dirOk) return null;
  const mode = defaultMode.value;
  const audio = audioFormat.value;
  const concurrent = Number(maxConcurrent.value);
  return {
    outputDir: dir,
    defaultMode: isMode(mode) ? mode : 'video',
    defaultHeight: Number(defaultHeight.value) || 1080,
    audioFormat: isAudioFormat(audio) ? audio : 'mp3',
    maxConcurrent: isMaxConcurrent(concurrent) ? concurrent : 2,
  };
}

async function checkHelper(): Promise<void> {
  const status = $('#status');
  status.replaceChildren(h('dt', {}, 'Status'), h('dd', {}, 'Checking…'));
  const res = await ask<HelloResponse>({ kind: 'hello' });
  if (!res.ok) {
    status.replaceChildren(
      h('dt', {}, 'Status'),
      h(
        'dd',
        {},
        h('span', { class: 'error-text' }, res.error.message),
        ' ',
        h('a', { href: README_URL, target: '_blank', rel: 'noreferrer' }, 'Setup guide'),
      ),
    );
    return;
  }
  const hello = res.data;
  $('#outputDir-hint').textContent = `Leave empty to use ${hello.defaultOutputDir}`;
  outputDir.placeholder = hello.defaultOutputDir;
  const okOrMissing = (ok: boolean, text: string) =>
    h('dd', {}, h('span', { class: ok ? 'ok' : 'error-text' }, text));
  status.replaceChildren(
    h('dt', {}, 'Helper app'),
    okOrMissing(true, `Connected (v${hello.hostVersion})`),
    h('dt', {}, 'yt-dlp'),
    okOrMissing(hello.ytDlpVersion !== null, hello.ytDlpVersion ?? 'Not found: winget install yt-dlp.yt-dlp'),
    h('dt', {}, 'ffmpeg'),
    okOrMissing(hello.ffmpeg, hello.ffmpeg ? 'Found' : 'Not found: winget install Gyan.FFmpeg'),
  );
}

async function init(): Promise<void> {
  for (const hgt of QUALITY_PRESETS) defaultHeight.append(h('option', { value: String(hgt) }, `${hgt}p`));
  fill(await getSettings());

  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const settings = readForm();
    if (!settings) return;
    void saveSettings(settings).then(() => {
      const saved = $('#saved');
      saved.textContent = 'Saved';
      setTimeout(() => (saved.textContent = ''), 2000);
    });
  });
  $('#recheck').addEventListener('click', () => void checkHelper());
  await checkHelper();
}

void init();
