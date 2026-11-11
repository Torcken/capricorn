/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Capricorn: Google OAuth sign-in removed.
 *
 * Upstream implemented "Sign in with Google" (browser and user-code flows,
 * token refresh, credential caching in `~/.gemini/oauth_creds.json` or the
 * keychain) on top of `google-auth-library`. Capricorn has no Google
 * back-end and forces the auth type to Ollama, so none of this is reachable.
 * The exported names are kept as inert stand-ins so upstream call sites (for
 * example "clear cached credentials" on logout) still compile; requesting a
 * Google client throws.
 */

import { EventEmitter } from 'node:events';
import type { AuthType } from '../core/contentGenerator.js';
import type { Config } from '../config/config.js';
import { CodeAssistNotSupportedError } from './server.js';

/** Kept for listeners registered by upstream code; never emits. */
export const authEvents = new EventEmitter();

/**
 * An Authentication URL for updating the credentials of a Oauth2Client
 * as well as a promise that will resolve when the credentials have
 * been refreshed (or which throws error when refreshing credentials failed).
 */
export interface OauthWebLogin {
  authUrl: string;
  loginCompletePromise: Promise<void>;
}

/**
 * Capricorn: always rejects; there is no Google sign-in.
 * @throws {CodeAssistNotSupportedError}
 */
export async function getOauthClient(
  _authType: AuthType,
  _config: Config,
): Promise<never> {
  throw new CodeAssistNotSupportedError();
}

/** No-op: no Google OAuth client is ever cached. */
export function clearOauthClientCache(): void {}

/** No-op: Capricorn never stores Google OAuth credentials. */
export async function clearCachedCredentialFile(): Promise<void> {}

/** No-op test hook kept for upstream tests. */
export function resetOauthClientForTesting(): void {}
