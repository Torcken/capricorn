/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Capricorn: Google account / Cloud project onboarding removed.
 *
 * Upstream's `setupUser` loaded and onboarded the user's Code Assist tier
 * through Google APIs. Capricorn has no Google sign-in, so it always rejects.
 * The error classes and `UserData` type are kept unchanged because other code
 * (error handling, UI) still recognises them.
 */

import type { GeminiUserTier, IneligibleTier, UserTierId } from './types.js';
import type { Config } from '../config/config.js';
import { CodeAssistNotSupportedError, type HttpOptions } from './server.js';

export class ProjectIdRequiredError extends Error {
  constructor() {
    super(
      'This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID env var. See https://geminicli.com/docs/get-started/authentication/#set-gcp',
    );
    this.name = 'ProjectIdRequiredError';
  }
}

export class InvalidNumericProjectIdError extends Error {
  constructor(projectId: string) {
    super(
      `Invalid Google Cloud Project ID: "${projectId}". The GOOGLE_CLOUD_PROJECT (or GOOGLE_CLOUD_PROJECT_ID) environment variable must be set to your string-based Project ID (e.g., "my-project-123"), not your numeric Project Number. Please update your environment variables.`,
    );
    this.name = 'InvalidNumericProjectIdError';
  }
}

export class ValidationCancelledError extends Error {
  constructor() {
    super('User cancelled account validation');
    this.name = 'ValidationCancelledError';
  }
}

export class IneligibleTierError extends Error {
  readonly ineligibleTiers: IneligibleTier[];

  constructor(ineligibleTiers: IneligibleTier[]) {
    const reasons = ineligibleTiers.map((t) => t.reasonMessage).join(', ');
    super(reasons);
    this.name = 'IneligibleTierError';
    this.ineligibleTiers = ineligibleTiers;
  }
}

export interface UserData {
  projectId: string;
  userTier: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;
  hasOnboardedPreviously?: boolean;
}

/** No-op: there is no user-data cache any more. */
export function resetUserDataCacheForTesting(): void {}

/**
 * Capricorn: always rejects; there is no Google account to set up.
 * @throws {CodeAssistNotSupportedError}
 */
export async function setupUser(
  _client: unknown,
  _config: Config,
  _httpOptions: HttpOptions = {},
): Promise<UserData> {
  throw new CodeAssistNotSupportedError();
}
