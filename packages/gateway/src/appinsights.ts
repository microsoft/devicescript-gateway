import * as mq from "./mq"
import * as appInsights from "applicationinsights"
import { ContextTagKeys } from "applicationinsights/out/Declarations/Contracts"
import { registerMessageSink } from "./messages"

// telemetry from devices
let _devsTelemetry: appInsights.TelemetryClient
export async function setup() {
    const connString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
    if (!connString) {
        console.log(`no application insights connection string, skipping`)
        return
    }

    appInsights
        .setup(connString)
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
        name: "app insights events",
        topicName: "tev",
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

            device.trackEvent(`devs.${name}`, { properties, measurements })
        },
    })

    registerMessageSink({
        name: "app insights metrics",
        topicName: "tme",
        ingest: async (message, device) => {
            const {
                n: name,
                v: value,
                mi: min,
                ma: max,
                c: count,
                a: variance,
                p: properties,
            } = message as object as {
                n: string
                v: number
                mi: number
                ma: number
                c: number
                a: number
                p?: Record<string, string>
            }
            const stdDev = isNaN(variance) ? undefined : Math.sqrt(variance)
            // ignore sum
            device.trackMetric(`devs.${name}`, {
                value,
                min,
                max,
                count,
                stdDev,
                properties,
            })
        },
    })
}

export function serverTelemetry(): appInsights.TelemetryClient {
    return _devsTelemetry ? appInsights.defaultClient : undefined
}

export function devsTelemetry(): appInsights.TelemetryClient {
    return _devsTelemetry
}

export const contextTagKeys = new ContextTagKeys()
