/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthType } from '../core/contentGenerator.js';
import { CodeAssistNotSupportedError, CodeAssistServer } from './server.js';
import {
  createCodeAssistContentGenerator,
  getCodeAssistServer,
} from './codeAssist.js';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from '../core/loggingContentGenerator.js';
import { ModelMappingContentGenerator } from '../core/modelMappingContentGenerator.js';

// Mock dependencies
vi.mock('./server.js');
vi.mock('../core/loggingContentGenerator.js');
vi.mock('../core/modelMappingContentGenerator.js');

const MockedCodeAssistServer = vi.mocked(CodeAssistServer);
const MockedLoggingContentGenerator = vi.mocked(LoggingContentGenerator);
const MockedModelMappingContentGenerator = vi.mocked(
  ModelMappingContentGenerator,
);

describe('codeAssist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Capricorn: Google sign-in / Code Assist generators were removed;
  // upstream's creation tests are replaced by a refusal test.
  describe('createCodeAssistContentGenerator', () => {
    it.each([AuthType.LOGIN_WITH_GOOGLE, AuthType.COMPUTE_ADC])(
      'refuses %s',
      async (authType) => {
        await expect(
          createCodeAssistContentGenerator({}, authType, {} as Config),
        ).rejects.toBeInstanceOf(CodeAssistNotSupportedError);
      },
    );
  });

  describe('getCodeAssistServer', () => {
    it('should return the server if it is a CodeAssistServer', () => {
      const mockServer = new MockedCodeAssistServer({} as never, '', {});
      const mockConfig = {
        getContentGenerator: () => mockServer,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBe(mockServer);
    });

    it('should unwrap and return the server if it is wrapped in a LoggingContentGenerator', () => {
      const mockServer = new MockedCodeAssistServer({} as never, '', {});
      const mockLogger = new MockedLoggingContentGenerator(
        {} as never,
        {} as never,
      );
      vi.spyOn(mockLogger, 'getWrapped').mockReturnValue(mockServer);

      const mockConfig = {
        getContentGenerator: () => mockLogger,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBe(mockServer);
      expect(mockLogger.getWrapped).toHaveBeenCalled();
    });

    it('should return undefined if the content generator is not a CodeAssistServer', () => {
      const mockGenerator = { a: 'generator' }; // Not a CodeAssistServer
      const mockConfig = {
        getContentGenerator: () => mockGenerator,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBeUndefined();
    });

    it('should return undefined if the wrapped generator is not a CodeAssistServer', () => {
      const mockGenerator = { a: 'generator' }; // Not a CodeAssistServer
      const mockLogger = new MockedLoggingContentGenerator(
        {} as never,
        {} as never,
      );
      vi.spyOn(mockLogger, 'getWrapped').mockReturnValue(
        mockGenerator as never,
      );

      const mockConfig = {
        getContentGenerator: () => mockLogger,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBeUndefined();
    });

    it('should unwrap and return the server if it is wrapped in a ModelMappingContentGenerator', () => {
      const mockServer = new MockedCodeAssistServer({} as never, '', {});
      const mockMapper = new MockedModelMappingContentGenerator(
        {} as never,
        {},
      );
      vi.spyOn(mockMapper, 'getWrapped').mockReturnValue(mockServer);

      const mockConfig = {
        getContentGenerator: () => mockMapper,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBe(mockServer);
      expect(mockMapper.getWrapped).toHaveBeenCalled();
    });

    it('should recursively unwrap multiple layers of LoggingContentGenerator and ModelMappingContentGenerator', () => {
      const mockServer = new MockedCodeAssistServer({} as never, '', {});
      const mockLogger = new MockedLoggingContentGenerator(
        {} as never,
        {} as never,
      );
      const mockMapper = new MockedModelMappingContentGenerator(
        {} as never,
        {},
      );

      // Mapper wraps Logger wraps Server
      vi.spyOn(mockMapper, 'getWrapped').mockReturnValue(mockLogger);
      vi.spyOn(mockLogger, 'getWrapped').mockReturnValue(mockServer);

      const mockConfig = {
        getContentGenerator: () => mockMapper,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBe(mockServer);
      expect(mockMapper.getWrapped).toHaveBeenCalled();
      expect(mockLogger.getWrapped).toHaveBeenCalled();
    });
  });
});
