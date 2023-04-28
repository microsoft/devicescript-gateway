import { ConnectedDevice } from "./wssk"

export type Message = object

export interface MessageSink {
    /**
     * Human description of the sink
     */
    name: string
    /**
     * may be undefined for 'unmarked' messages
     */
    topicName: string | "*"

    /**
     * Ingest incoming message
     * @param message
     */
    ingest(message: Message, device: ConnectedDevice): Promise<void>
}

const messageSinks: MessageSink[] = []

/**
 * Adds a device message sink
 * @param sink
 */
export function registerMessageSink(sink: MessageSink) {
    messageSinks.push(sink)
}

/**
 * Processes a device message
 * @param message
 * @param context
 * @returns
 */
export async function ingestMessage(
    topicName: string,
    message: Message,
    device: ConnectedDevice
) {
    if (!message) return

    // collect sinks interrested
    let sinks = messageSinks.filter(({ topicName: type }) => type === topicName)
    if (!sinks.length)
        sinks = messageSinks.filter(({ topicName }) => topicName === "*")

    // dispatch
    await Promise.all(sinks.map(sink => sink.ingest(message, device)))
}

export type LogSink = (logs: string[], device: ConnectedDevice) => Promise<void>
const logSinks: LogSink[] = []
export function registerLogSink(sink: LogSink) {
    logSinks.push(sink)
}
export async function ingestLogs(logs: string[], device: ConnectedDevice) {
    await Promise.all(logSinks.map(sink => sink(logs, device)))
}
