/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type AgentLoopContext,
  AuthType,
  getVersion,
} from '@google/gemini-cli-core';
import * as acp from '@agentclientprotocol/sdk';
import type { LoadedSettings } from '../config/settings.js';
import type { CliArgs } from '../config/config.js';
import { getAcpErrorMessage } from './acpErrors.js';
import { AcpSessionManager, type AuthDetails } from './acpSessionManager.js';

export class GeminiAgent {
  // Capricorn: never set (no API keys or gateways); kept for the session
  // manager's upstream AuthDetails shape.
  private readonly apiKey: string | undefined = undefined;
  private readonly baseUrl: string | undefined = undefined;
  private readonly customHeaders: Record<string, string> | undefined =
    undefined;
  private sessionManager: AcpSessionManager;

  constructor(
    private context: AgentLoopContext,
    settings: LoadedSettings,
    argv: CliArgs,
    connection: acp.AgentSideConnection,
  ) {
    this.sessionManager = new AcpSessionManager(settings, argv, connection);
  }

  async dispose(): Promise<void> {
    await this.sessionManager.dispose();
  }

  async initialize(
    args: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    if (args.clientCapabilities) {
      this.sessionManager.setClientCapabilities(args.clientCapabilities);
    }

    // Capricorn: one method, the local Ollama daemon. Upstream advertised
    // Google login, Gemini API key, Vertex AI and a gateway, none of which
    // exist here (createContentGenerator rejects them).
    const authMethods = [
      {
        id: AuthType.OLLAMA,
        name: 'Local Ollama (Gemma 4)',
        description:
          'Run a verified Gemma 4 model through the Ollama daemon on this machine',
      },
    ];

    await this.context.config.initialize();
    const version = await getVersion();
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      authMethods,
      agentInfo: {
        name: 'capricorn',
        title: 'Capricorn',
        version,
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
      },
    };
  }

  async authenticate(req: acp.AuthenticateRequest): Promise<void> {
    // Capricorn: only the local method exists; there are no credentials,
    // API keys or gateway details to accept or store.
    if (req.methodId !== AuthType.OLLAMA) {
      throw new acp.RequestError(
        -32602,
        `Unsupported auth method "${req.methodId}". Capricorn runs Gemma 4 models through local Ollama only; use "${AuthType.OLLAMA}".`,
      );
    }
    try {
      await this.context.config.refreshAuth(AuthType.OLLAMA);
    } catch (e) {
      throw new acp.RequestError(-32000, getAcpErrorMessage(e));
    }
  }

  private getAuthDetails(): AuthDetails {
    return {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      customHeaders: this.customHeaders,
    };
  }

  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    return this.sessionManager.newSession(params, this.getAuthDetails());
  }

  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    return this.sessionManager.loadSession(params, this.getAuthDetails());
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    await session.cancelPendingPrompt();
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    return session.prompt(params);
  }

  async setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    return session.setMode(params.modeId);
  }

  async unstable_setSessionModel(
    params: acp.SetSessionModelRequest,
  ): Promise<acp.SetSessionModelResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    return session.setModel(params.modelId);
  }
}
