/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../config/config.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
  bufferTelemetryEvent,
} from './sdk.js';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter as OTLPLogExporterHttp } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
import { Metadata } from '@grpc/grpc-js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { TelemetryTarget } from './index.js';

import * as os from 'node:os';
import * as path from 'node:path';

import { debugLogger } from '../utils/debugLogger.js';

vi.mock('@opentelemetry/exporter-trace-otlp-grpc');
vi.mock('@opentelemetry/exporter-logs-otlp-grpc');
vi.mock('@opentelemetry/exporter-metrics-otlp-grpc');
vi.mock('@opentelemetry/exporter-trace-otlp-http');
vi.mock('@opentelemetry/exporter-logs-otlp-http');
vi.mock('@opentelemetry/exporter-metrics-otlp-http');
vi.mock('@opentelemetry/sdk-trace-node');
vi.mock('@opentelemetry/sdk-node');
vi.mock('../utils/debugLogger.js', () => ({
  debugLogger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Telemetry SDK', () => {
  let mockConfig: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      getTelemetryEnabled: () => true,
      getTelemetryOtlpEndpoint: () => 'http://localhost:4317',
      getTelemetryOtlpProtocol: () => 'grpc',
      getTelemetryOtlpHeaders: () => ({}),
      getTelemetryTarget: () => 'local',
      getTelemetryUseCollector: () => false,
      getTelemetryOutfile: () => undefined,
      getDebugMode: () => false,
      getSessionId: () => 'test-session',
      getTelemetryUseCliAuth: () => false,
      isInteractive: () => false,
      getExperiments: () => undefined,
      getExperimentsAsync: async () => undefined,
      getContentGeneratorConfig: () => undefined,
    } as unknown as Config;
  });

  afterEach(async () => {
    await shutdownTelemetry(mockConfig);
  });

  it('should use gRPC exporters when protocol is grpc', async () => {
    await initializeTelemetry(mockConfig);

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'http://localhost:4317',
      compression: 'gzip',
    });
    expect(OTLPLogExporter).toHaveBeenCalledWith({
      url: 'http://localhost:4317',
      compression: 'gzip',
    });
    expect(OTLPMetricExporter).toHaveBeenCalledWith({
      url: 'http://localhost:4317',
      compression: 'gzip',
    });
    expect(NodeSDK.prototype.start).toHaveBeenCalled();
  });

  it('should use HTTP exporters when protocol is http', async () => {
    vi.spyOn(mockConfig, 'getTelemetryEnabled').mockReturnValue(true);
    vi.spyOn(mockConfig, 'getTelemetryOtlpProtocol').mockReturnValue('http');
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'http://localhost:4318',
    );

    await initializeTelemetry(mockConfig);

    expect(OTLPTraceExporterHttp).toHaveBeenCalledWith({
      url: 'http://localhost:4318/v1/traces',
    });
    expect(OTLPLogExporterHttp).toHaveBeenCalledWith({
      url: 'http://localhost:4318/v1/logs',
    });
    expect(OTLPMetricExporterHttp).toHaveBeenCalledWith({
      url: 'http://localhost:4318/v1/metrics',
    });
    expect(NodeSDK.prototype.start).toHaveBeenCalled();
  });

  it('should pass custom headers to HTTP exporters when otlpHeaders is configured', async () => {
    const customHeaders = {
      Authorization: 'Bearer secret-token',
      'x-api-key': 'my-api-key',
    };
    vi.spyOn(mockConfig, 'getTelemetryOtlpProtocol').mockReturnValue('http');
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'http://localhost:4318',
    );
    vi.spyOn(mockConfig, 'getTelemetryOtlpHeaders').mockReturnValue(
      customHeaders,
    );

    await initializeTelemetry(mockConfig);

    expect(OTLPTraceExporterHttp).toHaveBeenCalledWith({
      url: 'http://localhost:4318/v1/traces',
      headers: customHeaders,
    });
    expect(OTLPLogExporterHttp).toHaveBeenCalledWith({
      url: 'http://localhost:4318/v1/logs',
      headers: customHeaders,
    });
    expect(OTLPMetricExporterHttp).toHaveBeenCalledWith({
      url: 'http://localhost:4318/v1/metrics',
      headers: customHeaders,
    });
  });

  it('should pass custom metadata to gRPC exporters when otlpHeaders is configured', async () => {
    const customHeaders = {
      Authorization: 'Bearer secret-token',
      'x-api-key': 'my-api-key',
    };
    vi.spyOn(mockConfig, 'getTelemetryOtlpProtocol').mockReturnValue('grpc');
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'http://localhost:4317',
    );
    vi.spyOn(mockConfig, 'getTelemetryOtlpHeaders').mockReturnValue(
      customHeaders,
    );

    await initializeTelemetry(mockConfig);

    for (const ExporterMock of [
      OTLPTraceExporter,
      OTLPLogExporter,
      OTLPMetricExporter,
    ]) {
      expect(ExporterMock).toHaveBeenCalledTimes(1);
      const callArg = vi.mocked(ExporterMock).mock.calls[0]?.[0] as {
        url?: string;
        compression?: string;
        metadata?: Metadata;
      };
      expect(callArg?.url).toBe('http://localhost:4317');
      expect(callArg?.compression).toBe('gzip');
      expect(callArg?.metadata).toBeInstanceOf(Metadata);
      expect(callArg?.metadata?.get('authorization')).toEqual([
        'Bearer secret-token',
      ]);
      expect(callArg?.metadata?.get('x-api-key')).toEqual(['my-api-key']);
    }
  });

  it('should skip invalid gRPC metadata keys and log a warning without crashing', async () => {
    const customHeaders = {
      bad$key: 'invalid-for-grpc',
      'x-valid-key': 'valid-value',
    };
    vi.spyOn(mockConfig, 'getTelemetryOtlpProtocol').mockReturnValue('grpc');
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'http://localhost:4317',
    );
    vi.spyOn(mockConfig, 'getTelemetryOtlpHeaders').mockReturnValue(
      customHeaders,
    );

    await initializeTelemetry(mockConfig);

    expect(debugLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[Telemetry] Skipping invalid gRPC metadata key "bad$key":',
      ),
      expect.any(Error),
    );
    const callArg = vi.mocked(OTLPTraceExporter).mock.calls[0]?.[0] as {
      metadata?: Metadata;
    };
    expect(callArg?.metadata).toBeInstanceOf(Metadata);
    expect(callArg?.metadata?.get('x-valid-key')).toEqual(['valid-value']);
  });

  it('should parse gRPC endpoint correctly', async () => {
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'https://my-collector.com',
    );
    await initializeTelemetry(mockConfig);
    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://my-collector.com' }),
    );
  });

  it('should parse HTTP endpoint correctly', async () => {
    vi.spyOn(mockConfig, 'getTelemetryOtlpProtocol').mockReturnValue('http');
    vi.spyOn(mockConfig, 'getTelemetryOtlpEndpoint').mockReturnValue(
      'https://my-collector.com',
    );
    await initializeTelemetry(mockConfig);
    expect(OTLPTraceExporterHttp).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://my-collector.com/v1/traces' }),
    );
  });

  // Capricorn: direct Google Cloud export and Google-sign-in ("CLI auth")
  // telemetry were removed; upstream's tests for them are replaced by these.
  it('refuses direct Google Cloud export (target gcp without a collector)', async () => {
    vi.spyOn(mockConfig, 'getTelemetryTarget').mockReturnValue(
      TelemetryTarget.GCP,
    );
    vi.spyOn(mockConfig, 'getTelemetryUseCollector').mockReturnValue(false);
    await initializeTelemetry(mockConfig);
    expect(NodeSDK.prototype.start).not.toHaveBeenCalled();
  });

  it('refuses CLI-auth (Google sign-in) telemetry', async () => {
    vi.spyOn(mockConfig, 'getTelemetryUseCliAuth').mockReturnValue(true);
    await initializeTelemetry(mockConfig);
    expect(NodeSDK.prototype.start).not.toHaveBeenCalled();
  });

  it('should use OTLP exporters when target is gcp but useCollector is true', async () => {
    vi.spyOn(mockConfig, 'getTelemetryTarget').mockReturnValue(
      TelemetryTarget.GCP,
    );
    vi.spyOn(mockConfig, 'getTelemetryUseCollector').mockReturnValue(true);

    await initializeTelemetry(mockConfig);

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'http://localhost:4317',
      compression: 'gzip',
    });
    expect(OTLPLogExporter).toHaveBeenCalledWith({
      url: 'http://localhost:4317',
      compression: 'gzip',
    });
    expect(OTLPMetricExporter).toHaveBeenCalledWith({
      url: 'http://localhost:4317',
      compression: 'gzip',
    });
  });

  it('should not use OTLP exporters when telemetryOutfile is set', async () => {
    vi.spyOn(mockConfig, 'getTelemetryOutfile').mockReturnValue(
      path.join(os.tmpdir(), 'test.log'),
    );
    await initializeTelemetry(mockConfig);

    expect(OTLPTraceExporter).not.toHaveBeenCalled();
    expect(OTLPLogExporter).not.toHaveBeenCalled();
    expect(OTLPMetricExporter).not.toHaveBeenCalled();
    expect(OTLPTraceExporterHttp).not.toHaveBeenCalled();
    expect(OTLPLogExporterHttp).not.toHaveBeenCalled();
    expect(OTLPMetricExporterHttp).not.toHaveBeenCalled();
    expect(NodeSDK.prototype.start).toHaveBeenCalled();
  });

  describe('bufferTelemetryEvent', () => {
    it('should execute immediately if SDK is initialized', async () => {
      await initializeTelemetry(mockConfig);
      const callback = vi.fn();
      bufferTelemetryEvent(callback);
      expect(callback).toHaveBeenCalled();
    });

    it('should buffer if SDK is not initialized, and flush on initialization', async () => {
      const callback = vi.fn();
      bufferTelemetryEvent(callback);
      expect(callback).not.toHaveBeenCalled();

      await initializeTelemetry(mockConfig);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalled();
    });
  });

  it('should disable telemetry and log error if useCollector and useCliAuth are both true', async () => {
    vi.spyOn(mockConfig, 'getTelemetryUseCollector').mockReturnValue(true);
    vi.spyOn(mockConfig, 'getTelemetryUseCliAuth').mockReturnValue(true);

    await initializeTelemetry(mockConfig);

    expect(debugLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Telemetry configuration error: "useCollector" and "useCliAuth" cannot both be true',
      ),
    );
    expect(NodeSDK.prototype.start).not.toHaveBeenCalled();
  });
  it('should log error when re-initializing with different credentials', async () => {
    const creds1 = { client_email: 'user1@example.com' };
    const creds2 = { client_email: 'user2@example.com' };

    // 1. Initialize with first account
    await initializeTelemetry(mockConfig, creds1);

    // 2. Attempt to initialize with second account
    await initializeTelemetry(mockConfig, creds2);

    // 3. Verify error log
    expect(debugLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Telemetry credentials have changed (from user1@example.com to user2@example.com)',
      ),
    );
  });

  it('should NOT log error when re-initializing with SAME credentials', async () => {
    const creds1 = { client_email: 'user1@example.com' };

    // 1. Initialize with first account
    await initializeTelemetry(mockConfig, creds1);

    // 2. Attempt to initialize with same account
    await initializeTelemetry(mockConfig, creds1);

    // 3. Verify NO error log
    expect(debugLogger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Telemetry credentials have changed'),
    );
  });
});
