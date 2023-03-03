export interface TelemetrySource {
    brainId: string // "161f314155de245b"
    sensorId: string // "260f3e4155de245b"
    srv: string // "temperature"
    srvIdx: number // typically 0
}

export interface Telemetry extends TelemetrySource {
    ms: number // milliseconds since epoch aka Date.now()
    avg: number // 22.2 C, etc
    min?: number
    max?: number
    nsampl?: number // number of samples
    dur?: number // sampling time is from [ms-dur, ms]
}

export type TelemetrySink = (
    part: string,
    entries: Telemetry[]
) => Promise<void>

export const telemetrySinks: TelemetrySink[] = []

export async function insertTelemetry(part: string, entries: Telemetry[]) {
    await Promise.all(telemetrySinks.map(sink => sink(part, entries)))
}
