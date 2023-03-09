import { ConnectedDevice } from "./wssk"

export type Message = {
    _:
        | "tev" // trackEvent, reserved
        | string
} & object

export interface MessageSink {
    /**
     * Human description of the sink
     */
    name: string
    /**
     * value in '_', may be undefined for 'unmarked' messages
     */
    type?: string

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
export async function ingestMessage(message: Message, device: ConnectedDevice) {
    if (!message) return

    // what type of message
    const messageType = message._

    // collect sinks interrested
    const sinks = messageSinks.filter(({ type }) => type === messageType)

    // dispatch
    await Promise.all(sinks.map(sink => sink.ingest(message, device)))
}
