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
    topicName?: string

    /**
     * Ingest incoming message
     * @param message
     */
    ingest(message: Message, device: ConnectedDevice): Promise<boolean>
}

const messageSinks: MessageSink[] = []

/**
 * Adds a device message sink, not on mqtt broker
 * @param sink
 */
export function registerInfrastructureMessageSink(sink: MessageSink) {
    messageSinks.push(sink)
}

/**
 * Processes a device message, not on mqtt broker
 * @param message
 * @param context
 * @returns
 */
export async function ingestInfrastructureMessage(
    topicName: string,
    message: Message,
    device: ConnectedDevice
): Promise<boolean> {
    if (!message) return false

    // collect sinks interrested
    const sinks = messageSinks.filter(
        ({ topicName: type }) => type === topicName
    )
    if (!sinks?.length) return false

    // dispatch
    await Promise.all(sinks.map(sink => sink.ingest(message, device)))
    return true
}
