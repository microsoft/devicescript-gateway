import * as appInsights from "applicationinsights"
import { ContextTagKeys } from "applicationinsights/out/Declarations/Contracts"
import { registerMessageSink } from "./messages"

// telemetry from devices
let _devsTelemetry: appInsights.TelemetryClient
export async function setup() {
    appInsights
        .setup()
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true, true)
        .setUseDiskRetryCaching(true)
        .setAutoCollectPreAggregatedMetrics(true)
        .setSendLiveMetrics(false)
        .setAutoCollectHeartbeat(false)
        .setAutoCollectIncomingRequestAzureFunctions(false)
        .setInternalLogging(false, true)
        .enableWebInstrumentation(false)
        .start()
    // don't start, use custom events
    _devsTelemetry = new appInsights.TelemetryClient()
    _devsTelemetry.trackEvent({
        name: "server.start",
    })

    registerMessageSink({
        name: "app insights",
        type: "tev",
        ingest: async (message, device) => {
            const {
                n: name,
                p: properties,
                m: measurements,
            } = message as object as {
                n: string
                p?: Record<string, string>
                m?: Record<string, number>
            }

            device.trackEvent(`dev.from.${name}`, { properties, measurements })
        },
    })
}

export function serverTelemetry(): appInsights.TelemetryClient {
    return appInsights.defaultClient
}

export function devsTelemetry(): appInsights.TelemetryClient {
    return _devsTelemetry
}

export const contextTagKeys = new ContextTagKeys()
