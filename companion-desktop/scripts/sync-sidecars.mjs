// Copy the compiled companion binaries into src-tauri/binaries/ with the
// Rust target-triple suffix Tauri's sidecar bundler expects. Run before
// `tauri dev` / `tauri build`. Source: companion/dist (build it first
// with `bun run build -w @hauler-helper/companion`).

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', '..', 'companion', 'dist');
const out = join(here, '..', 'src-tauri', 'binaries');
mkdirSync(out, { recursive: true });

const host = execSync('rustc -vV').toString().match(/host: (\S+)/)?.[1];
if (!host) {
  console.error('Could not determine host target triple (is Rust installed?).');
  process.exit(1);
}

let copied = 0;
const copy = (from, to) => {
  if (!existsSync(join(dist, from))) return;
  copyFileSync(join(dist, from), join(out, to));
  console.log(`→ ${to}`);
  copied++;
};

// Host binary (what `tauri build` on this machine needs).
if (!host.includes('windows')) copy('mission-mate-linux', `mission-mate-${host}`);
// Windows sidecar, for a Windows build host / CI.
copy('mission-mate-windows.exe', 'mission-mate-x86_64-pc-windows-msvc.exe');

if (copied === 0) {
  console.error(
    `No companion binaries in ${dist}.\n` +
      'Build them first:  bun run build -w @hauler-helper/companion',
  );
  process.exit(1);
}
