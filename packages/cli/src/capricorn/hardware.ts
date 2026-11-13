/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Local hardware detection for model recommendations.
 *
 * Only reads local facts: total RAM from the OS, NVIDIA GPUs through
 * `nvidia-smi` (if installed), AMD GPUs through Linux sysfs, and Apple
 * Silicon's unified memory. Nothing is sent anywhere. Every probe is
 * best-effort: a missing tool or unreadable file just means "no GPU of that
 * kind found", never an error, because detection only feeds a suggestion.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A GPU Ollama can offload a model to. */
export interface GpuInfo {
  vendor: 'nvidia' | 'amd' | 'apple';
  name: string;
  /** Dedicated VRAM, or for unified memory the whole system RAM. */
  memoryBytes: number;
  /** True for Apple Silicon, where GPU and CPU share system RAM. */
  unified: boolean;
}

/** What the recommendation needs to know about this machine. */
export interface HardwareProfile {
  totalMemoryBytes: number;
  platform: NodeJS.Platform;
  arch: string;
  cpus: number;
  gpus: GpuInfo[];
}

/** Side-effecting probes, injectable for tests. */
export interface HardwareProbes {
  totalmem: () => number;
  platform: () => NodeJS.Platform;
  arch: () => string;
  cpus: () => number;
  /** Runs a local command; resolves its stdout, or undefined on any failure. */
  run: (cmd: string, args: string[]) => Promise<string | undefined>;
  readdir: (dir: string) => string[];
  readFile: (file: string) => string | undefined;
}

const PROBE_TIMEOUT_MS = 3000;

/** Production probes. */
export const systemProbes: HardwareProbes = {
  totalmem: () => os.totalmem(),
  platform: () => os.platform(),
  arch: () => os.arch(),
  cpus: () => os.cpus().length,
  run: (cmd, args) =>
    new Promise((resolve) => {
      // Bounded: a wedged driver can make nvidia-smi hang, and this runs
      // before the session starts.
      execFile(
        cmd,
        args,
        { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => resolve(error ? undefined : String(stdout)),
      );
    }),
  readdir: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  readFile: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
};

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** NVIDIA GPUs from `nvidia-smi` (CSV: name, total memory in MiB). */
async function nvidiaGpus(probes: HardwareProbes): Promise<GpuInfo[]> {
  const out = await probes.run('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  if (!out) return [];
  const gpus: GpuInfo[] = [];
  for (const line of out.split('\n')) {
    const i = line.lastIndexOf(',');
    if (i === -1) continue;
    const name = line.slice(0, i).trim();
    const mib = Number(line.slice(i + 1).trim());
    if (name && Number.isFinite(mib) && mib > 0) {
      gpus.push({
        vendor: 'nvidia',
        name,
        memoryBytes: mib * MIB,
        unified: false,
      });
    }
  }
  return gpus;
}

/** AMD GPUs from Linux sysfs (`amdgpu` exposes total VRAM in bytes). */
function amdGpus(probes: HardwareProbes): GpuInfo[] {
  const root = '/sys/class/drm';
  const gpus: GpuInfo[] = [];
  for (const entry of probes.readdir(root)) {
    // card0, card1… (not connectors such as card1-DP-1).
    if (!/^card\d+$/.test(entry)) continue;
    const dev = path.posix.join(root, entry, 'device');
    if (probes.readFile(`${dev}/vendor`)?.trim() !== '0x1002') continue;
    const bytes = Number(probes.readFile(`${dev}/mem_info_vram_total`)?.trim());
    // Integrated GPUs report a small carve-out; too small to hold a model.
    if (!Number.isFinite(bytes) || bytes < GIB) continue;
    const name = probes.readFile(`${dev}/product_name`)?.trim() || 'AMD GPU';
    gpus.push({ vendor: 'amd', name, memoryBytes: bytes, unified: false });
  }
  return gpus;
}

/**
 * Environment variable holding a JSON {@link HardwareProfile} that replaces
 * detection. For tests of the compiled CLI (whose output must not depend on
 * the CI runner's hardware) and for seeing what another machine would be
 * recommended. It only changes advice, never which model runs.
 */
export const HARDWARE_PROFILE_ENV = 'CAPRICORN_HARDWARE_PROFILE';

/** Parses {@link HARDWARE_PROFILE_ENV}; undefined if unset or invalid. */
export function profileFromEnv(
  value: string | undefined,
): HardwareProfile | undefined {
  if (!value) return undefined;
  try {
    const p: unknown = JSON.parse(value);
    if (
      typeof p === 'object' &&
      p !== null &&
      'totalMemoryBytes' in p &&
      typeof p.totalMemoryBytes === 'number' &&
      'gpus' in p &&
      Array.isArray(p.gpus)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const partial = p as Partial<HardwareProfile> &
        Pick<HardwareProfile, 'totalMemoryBytes' | 'gpus'>;
      return {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        ...partial,
      };
    }
  } catch {
    // Invalid JSON: fall back to real detection.
  }
  return undefined;
}

/**
 * Detects RAM and GPUs. Never throws.
 *
 * @param probes Injectable probes (tests); defaults to the real system, or
 *   to {@link HARDWARE_PROFILE_ENV} when that is set.
 */
export async function detectHardware(
  probes?: HardwareProbes,
): Promise<HardwareProfile> {
  if (!probes) {
    const fromEnv = profileFromEnv(process.env[HARDWARE_PROFILE_ENV]);
    if (fromEnv) return fromEnv;
  }
  return probeHardware(probes ?? systemProbes);
}

async function probeHardware(probes: HardwareProbes): Promise<HardwareProfile> {
  const platform = probes.platform();
  const arch = probes.arch();
  const totalMemoryBytes = probes.totalmem();
  let gpus: GpuInfo[] = [];
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      gpus = [
        {
          vendor: 'apple',
          name: 'Apple Silicon GPU',
          memoryBytes: totalMemoryBytes,
          unified: true,
        },
      ];
    }
    // Intel Macs: Ollama runs on the CPU there.
  } else {
    gpus = await nvidiaGpus(probes).catch(() => []);
    if (platform === 'linux') gpus.push(...amdGpus(probes));
  }
  return { totalMemoryBytes, platform, arch, cpus: probes.cpus(), gpus };
}
