/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Capricorn: remote admin controls (fetched and polled from the Code Assist
// server) were removed; only sanitizing and the messages remain.

import { isDeepStrictEqual } from 'node:util';
import { describe, it, expect } from 'vitest';
import {
  sanitizeAdminSettings,
  getAdminErrorMessage,
  getAdminBlockedMcpServersMessage,
} from './admin_controls.js';
import type {
  FetchAdminControlsResponse,
  AdminControlsSettings,
} from '../types.js';

describe('Admin Controls', () => {
  describe('sanitizeAdminSettings', () => {
    it('should strip unknown fields and pass through mcpConfigJson when valid', () => {
      const mcpConfig = {
        mcpServers: {
          'server-1': {
            url: 'http://example.com',
            type: 'sse' as const,
            trust: true,
            includeTools: ['tool1'],
          },
        },
      };

      const input = {
        strictModeDisabled: false,
        extraField: 'should be removed',
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(mcpConfig),
          unknownMcpField: 'remove me',
        },
      };

      const result = sanitizeAdminSettings(
        input as unknown as FetchAdminControlsResponse,
      );

      expect(result).toEqual({
        strictModeDisabled: false,
        cliFeatureSetting: {
          extensionsSetting: { extensionsEnabled: false },
          unmanagedCapabilitiesEnabled: false,
        },
        mcpSetting: {
          mcpEnabled: true,
          mcpConfig,
        },
      });
    });

    it('should ignore mcpConfigJson if it is invalid JSON', () => {
      const input: FetchAdminControlsResponse = {
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: '{ invalid json }',
        },
      };

      const result = sanitizeAdminSettings(input);
      expect(result.mcpSetting).toEqual({
        mcpEnabled: true,
        mcpConfig: {},
      });
    });

    it('should ignore mcpConfigJson if it does not match schema', () => {
      const invalidConfig = {
        mcpServers: {
          'server-1': {
            url: 123, // should be string
            type: 'invalid-type', // should be sse or http
          },
        },
      };
      const input: FetchAdminControlsResponse = {
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(invalidConfig),
        },
      };

      const result = sanitizeAdminSettings(input);
      expect(result.mcpSetting).toEqual({
        mcpEnabled: true,
        mcpConfig: {},
      });
    });

    it('should apply default values when fields are missing', () => {
      const input = {};
      const result = sanitizeAdminSettings(input as FetchAdminControlsResponse);

      expect(result).toEqual({
        strictModeDisabled: false,
        cliFeatureSetting: {
          extensionsSetting: { extensionsEnabled: false },
          unmanagedCapabilitiesEnabled: false,
        },
        mcpSetting: {
          mcpEnabled: false,
          mcpConfig: {},
        },
      });
    });

    it('should default mcpEnabled to false if mcpSetting is present but mcpEnabled is undefined', () => {
      const input = { mcpSetting: {} };
      const result = sanitizeAdminSettings(input as FetchAdminControlsResponse);
      expect(result.mcpSetting?.mcpEnabled).toBe(false);
      expect(result.mcpSetting?.mcpConfig).toEqual({});
    });

    it('should default extensionsEnabled to false if extensionsSetting is present but extensionsEnabled is undefined', () => {
      const input = {
        cliFeatureSetting: {
          extensionsSetting: {},
        },
      };
      const result = sanitizeAdminSettings(input as FetchAdminControlsResponse);
      expect(
        result.cliFeatureSetting?.extensionsSetting?.extensionsEnabled,
      ).toBe(false);
    });

    it('should default unmanagedCapabilitiesEnabled to false if cliFeatureSetting is present but unmanagedCapabilitiesEnabled is undefined', () => {
      const input = {
        cliFeatureSetting: {},
      };
      const result = sanitizeAdminSettings(input as FetchAdminControlsResponse);
      expect(result.cliFeatureSetting?.unmanagedCapabilitiesEnabled).toBe(
        false,
      );
    });

    it('should reflect explicit values', () => {
      const input: FetchAdminControlsResponse = {
        strictModeDisabled: true,
        cliFeatureSetting: {
          extensionsSetting: { extensionsEnabled: true },
          unmanagedCapabilitiesEnabled: true,
        },
        mcpSetting: {
          mcpEnabled: true,
        },
      };

      const result = sanitizeAdminSettings(input);

      expect(result).toEqual({
        strictModeDisabled: true,
        cliFeatureSetting: {
          extensionsSetting: { extensionsEnabled: true },
          unmanagedCapabilitiesEnabled: true,
        },
        mcpSetting: {
          mcpEnabled: true,
          mcpConfig: {},
        },
      });
    });

    it('should prioritize strictModeDisabled over secureModeEnabled', () => {
      const input: FetchAdminControlsResponse = {
        strictModeDisabled: true,
        secureModeEnabled: true, // Should be ignored because strictModeDisabled takes precedence for backwards compatibility if both exist (though usually they shouldn't)
      };

      const result = sanitizeAdminSettings(input);
      expect(result.strictModeDisabled).toBe(true);
    });

    it('should use secureModeEnabled if strictModeDisabled is undefined', () => {
      const input: FetchAdminControlsResponse = {
        secureModeEnabled: false,
      };

      const result = sanitizeAdminSettings(input);
      expect(result.strictModeDisabled).toBe(true);
    });

    it('should parse requiredMcpServers from mcpConfigJson', () => {
      const mcpConfig = {
        mcpServers: {
          'allowed-server': {
            url: 'http://allowed.com',
            type: 'sse' as const,
          },
        },
        requiredMcpServers: {
          'corp-tool': {
            url: 'https://mcp.corp/tool',
            type: 'http' as const,
            trust: true,
            description: 'Corp compliance tool',
          },
        },
      };

      const input: FetchAdminControlsResponse = {
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(mcpConfig),
        },
      };

      const result = sanitizeAdminSettings(input);
      expect(result.mcpSetting?.mcpConfig?.mcpServers).toEqual(
        mcpConfig.mcpServers,
      );
      expect(result.mcpSetting?.requiredMcpConfig).toEqual(
        mcpConfig.requiredMcpServers,
      );
    });

    it('should sort requiredMcpServers tool lists for stable comparison', () => {
      const mcpConfig = {
        requiredMcpServers: {
          'corp-tool': {
            url: 'https://mcp.corp/tool',
            type: 'http' as const,
            includeTools: ['toolC', 'toolA', 'toolB'],
            excludeTools: ['toolZ', 'toolX'],
          },
        },
      };

      const input: FetchAdminControlsResponse = {
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(mcpConfig),
        },
      };

      const result = sanitizeAdminSettings(input);
      const corpTool = result.mcpSetting?.requiredMcpConfig?.['corp-tool'];
      expect(corpTool?.includeTools).toEqual(['toolA', 'toolB', 'toolC']);
      expect(corpTool?.excludeTools).toEqual(['toolX', 'toolZ']);
    });

    it('should handle mcpConfigJson with only requiredMcpServers and no mcpServers', () => {
      const mcpConfig = {
        requiredMcpServers: {
          'required-only': {
            url: 'https://required.corp/tool',
            type: 'http' as const,
          },
        },
      };

      const input: FetchAdminControlsResponse = {
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(mcpConfig),
        },
      };

      const result = sanitizeAdminSettings(input);
      expect(result.mcpSetting?.mcpConfig?.mcpServers).toBeUndefined();
      expect(result.mcpSetting?.requiredMcpConfig).toEqual(
        mcpConfig.requiredMcpServers,
      );
    });
  });

  describe('isDeepStrictEqual verification', () => {
    it('should consider AdminControlsSettings with different key orders as equal', () => {
      const settings1: AdminControlsSettings = {
        strictModeDisabled: false,
        mcpSetting: { mcpEnabled: true },
        cliFeatureSetting: { unmanagedCapabilitiesEnabled: true },
      };
      const settings2: AdminControlsSettings = {
        cliFeatureSetting: { unmanagedCapabilitiesEnabled: true },
        mcpSetting: { mcpEnabled: true },
        strictModeDisabled: false,
      };
      expect(isDeepStrictEqual(settings1, settings2)).toBe(true);
    });

    it('should consider nested settings objects with different key orders as equal', () => {
      const settings1: AdminControlsSettings = {
        mcpSetting: {
          mcpEnabled: true,
          mcpConfig: {
            mcpServers: {
              server1: { url: 'url', type: 'sse' },
            },
          },
        },
      };

      // Order swapped in mcpConfig and mcpServers items
      const settings2: AdminControlsSettings = {
        mcpSetting: {
          mcpConfig: {
            mcpServers: {
              server1: { type: 'sse', url: 'url' },
            },
          },
          mcpEnabled: true,
        },
      };
      expect(isDeepStrictEqual(settings1, settings2)).toBe(true);
    });

    it('should consider arrays in options as order-independent and equal if shuffled after sanitization', () => {
      const mcpConfig1 = {
        mcpServers: {
          server1: { includeTools: ['a', 'b'] },
        },
      };
      const mcpConfig2 = {
        mcpServers: {
          server1: { includeTools: ['b', 'a'] },
        },
      };

      const settings1 = sanitizeAdminSettings({
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(mcpConfig1),
        },
      });
      const settings2 = sanitizeAdminSettings({
        mcpSetting: {
          mcpEnabled: true,
          mcpConfigJson: JSON.stringify(mcpConfig2),
        },
      });

      expect(isDeepStrictEqual(settings1, settings2)).toBe(true);
    });
  });

  describe('getAdminErrorMessage', () => {
    it('names the feature and links nowhere', () => {
      expect(getAdminErrorMessage('Chat', undefined)).toBe(
        'Chat is disabled by your administrator.',
      );
    });
  });

  describe('getAdminBlockedMcpServersMessage', () => {
    it('counts a single blocked server', () => {
      expect(getAdminBlockedMcpServersMessage(['server-1'], undefined)).toBe(
        '1 MCP server is not allowlisted by your administrator.',
      );
    });

    it('counts multiple blocked servers', () => {
      expect(getAdminBlockedMcpServersMessage(['a', 'b', 'c'], undefined)).toBe(
        '3 MCP servers are not allowlisted by your administrator.',
      );
    });
  });
});
