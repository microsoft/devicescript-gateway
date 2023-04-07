import * as appInsights from "applicationinsights"
import {
    ContextTagKeys,
    TraceTelemetry,
} from "applicationinsights/out/Declarations/Contracts"
import { registerLogSink, registerMessageSink } from "../messages"
import { Contracts } from "applicationinsights"

// telemetry from devices
let _devsTelemetry: appInsights.TelemetryClient
export async function setup() {
    const connString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
    if (!connString) {
        console.log(`no env APPLICATIONINSIGHTS_CONNECTION_STRING, skipping`)
        return
    }

    appInsights
        .setup(connString)
        .setAutoDependencyCorrelation(false)
        .setAutoCollectRequests(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
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

    registerLogSink(async (logs, device) => device.traceTrace(logs))
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

const severities: Record<string, Contracts.SeverityLevel> = {
    ">": Contracts.SeverityLevel.Information,
    "!": Contracts.SeverityLevel.Error,
    "*": Contracts.SeverityLevel.Warning,
    "?": Contracts.SeverityLevel.Verbose,
}

export function logLineToTraceTelemetry(line: string) {
    const severity = severities[line?.[0]]
    if (!severity) return undefined
    return {
        message: line.slice(1),
        severity,
    } as Partial<TraceTelemetry>
}
