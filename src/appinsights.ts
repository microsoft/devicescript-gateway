import * as appInsights from "applicationinsights"
import { ContextTagKeys } from "applicationinsights/out/Declarations/Contracts"

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
}

export function serverTelemetry(): appInsights.TelemetryClient {
    return appInsights.defaultClient
}

export function devsTelemetry(): appInsights.TelemetryClient {
    return _devsTelemetry
}

export const contextTagKeys = new ContextTagKeys()
