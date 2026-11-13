/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { detectHardware, type HardwareProbes } from './hardware.js';

const GIB = 1024 ** 3;

function probes(over: Partial<HardwareProbes> = {}): HardwareProbes {
  return {
    totalmem: () => 32 * GIB,
    platform: () => 'linux',
    arch: () => 'x64',
    cpus: () => 8,
    run: async () => undefined,
    readdir: () => [],
    readFile: () => undefined,
    ...over,
  };
}

describe('detectHardware', () => {
  it('reads NVIDIA GPUs from nvidia-smi CSV output', async () => {
    const calls: string[][] = [];
    const hw = await detectHardware(
      probes({
        run: async (cmd, args) => {
          calls.push([cmd, ...args]);
          return 'NVIDIA GeForce RTX 4070, 12282\nNVIDIA A100-SXM4-80GB, 81920\n';
        },
      }),
    );
    expect(calls[0][0]).toBe('nvidia-smi');
    expect(hw.gpus).toEqual([
      {
        vendor: 'nvidia',
        name: 'NVIDIA GeForce RTX 4070',
        memoryBytes: 12282 * 1024 ** 2,
        unified: false,
      },
      {
        vendor: 'nvidia',
        name: 'NVIDIA A100-SXM4-80GB',
        memoryBytes: 81920 * 1024 ** 2,
        unified: false,
      },
    ]);
  });

  it('treats a missing or failing nvidia-smi as no NVIDIA GPU', async () => {
    const hw = await detectHardware(probes({ run: async () => undefined }));
    expect(hw.gpus).toEqual([]);
    expect(hw.totalMemoryBytes).toBe(32 * GIB);
  });

  it('ignores malformed nvidia-smi lines', async () => {
    const hw = await detectHardware(
      probes({ run: async () => 'garbage\n, 100\nGPU, [N/A]\n' }),
    );
    expect(hw.gpus).toEqual([]);
  });

  it('reads AMD VRAM from sysfs and skips connectors and small iGPUs', async () => {
    const files: Record<string, string> = {
      '/sys/class/drm/card0/device/vendor': '0x1002\n',
      '/sys/class/drm/card0/device/mem_info_vram_total': `${16 * GIB}\n`,
      '/sys/class/drm/card0/device/product_name': 'Radeon RX 7800 XT\n',
      // Integrated GPU with a 512 MiB carve-out.
      '/sys/class/drm/card1/device/vendor': '0x1002\n',
      '/sys/class/drm/card1/device/mem_info_vram_total': `${512 * 1024 ** 2}\n`,
      // Intel GPU: not AMD.
      '/sys/class/drm/card2/device/vendor': '0x8086\n',
    };
    const hw = await detectHardware(
      probes({
        readdir: () => ['card0', 'card0-DP-1', 'card1', 'card2', 'renderD128'],
        readFile: (f) => files[f],
      }),
    );
    expect(hw.gpus).toEqual([
      {
        vendor: 'amd',
        name: 'Radeon RX 7800 XT',
        memoryBytes: 16 * GIB,
        unified: false,
      },
    ]);
  });

  it('reports unified memory on Apple Silicon without running tools', async () => {
    let ran = false;
    const hw = await detectHardware(
      probes({
        platform: () => 'darwin',
        arch: () => 'arm64',
        totalmem: () => 36 * GIB,
        run: async () => {
          ran = true;
          return undefined;
        },
      }),
    );
    expect(ran).toBe(false);
    expect(hw.gpus).toEqual([
      {
        vendor: 'apple',
        name: 'Apple Silicon GPU',
        memoryBytes: 36 * GIB,
        unified: true,
      },
    ]);
  });

  it('finds no GPU on an Intel Mac', async () => {
    const hw = await detectHardware(
      probes({ platform: () => 'darwin', arch: () => 'x64' }),
    );
    expect(hw.gpus).toEqual([]);
  });
});
