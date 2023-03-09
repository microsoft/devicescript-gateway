export type Message = unknown

export type MessageSink = (message: Message) => Promise<void>

export const messageSinks: MessageSink[] = []

export async function ingestMessage(message: Message) {
    await Promise.all(messageSinks.map(sink => sink(message)))
}
