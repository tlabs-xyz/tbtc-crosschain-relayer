/**
 * OpenTelemetry instrumentation - must be loaded before any other application code.
 * Enables trace context propagation so logs can be correlated with traces in SigNoz.
 *
 * Load via: NODE_OPTIONS="--import ./dist/instrumentation.js" or import at top of index.ts
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const otelEnabled = process.env.OTEL_ENABLED === 'true';
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const serviceName = process.env.OTEL_SERVICE_NAME || process.env.APP_NAME || 'tbtc-crosschain-relayer';
const serviceVersion = process.env.APP_VERSION || '1.0.0-pre';

if (otelEnabled && otelEndpoint) {
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${otelEndpoint.replace(/\/$/, '')}/v1/traces`,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? Object.fromEntries(
          process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((h) => {
            const [k, v] = h.trim().split('=');
            return [k, v?.trim() ?? ''];
          }),
        )
      : undefined,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      // Auto-instrument HTTP, Express - provides trace context for log correlation
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Error shutting down OTel SDK', err);
        process.exit(1);
      });
  });
}
