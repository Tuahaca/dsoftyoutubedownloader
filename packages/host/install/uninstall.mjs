// Removes the Native Messaging host registration and the files install.mjs generated.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_NAME, hostDist, REG_KEY } from './lib.mjs';

if (process.platform !== 'win32') {
  console.error('Only Windows is supported by this uninstaller for now.');
  process.exit(1);
}

const reg = spawnSync('reg', ['delete', REG_KEY, '/f'], { shell: false, encoding: 'utf8' });
if (reg.status === 0) console.log(`✔ Removed registry key ${REG_KEY}`);
else console.log(`Registry key not present (${REG_KEY})`);

for (const name of ['host.bat', 'host-config.json', `${HOST_NAME}.json`]) {
  rmSync(join(hostDist, name), { force: true });
}
console.log('✔ Removed generated host files. You can now remove the extension in chrome://extensions.');
