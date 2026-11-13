/**
 * @license
 * Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

/** @fileoverview Registry of all Capricorn eval tasks, in report order. */

import type { EvalTask } from '../types.js';
import { editTasks } from './edit.task.js';
import { exploreTasks } from './explore.task.js';
import { safetyTasks } from './safety.task.js';
import { testFixTasks } from './testfix.task.js';
import { toolUseTasks } from './tooluse.task.js';

export const ALL_TASKS: readonly EvalTask[] = [
  ...exploreTasks,
  ...editTasks,
  ...testFixTasks,
  ...toolUseTasks,
  ...safetyTasks,
];

// Duplicate ids would silently merge rows in the report.
const ids = new Set<string>();
for (const t of ALL_TASKS) {
  if (ids.has(t.id)) throw new Error(`duplicate eval task id: ${t.id}`);
  ids.add(t.id);
}
