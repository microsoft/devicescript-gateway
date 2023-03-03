import * as appInsights from "applicationinsights"
import { ContextTagKeys } from "applicationinsights/out/Declarations/Contracts"

export async function setup() {
    appInsights.setup()
    // don't start, use custom events
    const tel = appInsights.defaultClient
    tel.trackEvent({
        name: "server.start",
    })
}

export function devsTelemetry(): appInsights.TelemetryClient {
    return appInsights.defaultClient
}

export const contextTagKeys = new ContextTagKeys()
