import { EventHubProducerClient } from "@azure/event-hubs"
import { serverTelemetry } from "./appinsights"
import { registerMessageSink } from "../messages"
import { getSecret } from "../secrets"

/**
 * Event Hub connection string
 */
export const DEVS_EVENT_HUB_CONNECTION_STRING =
    "DEVS_EVENT_HUB_CONNECTION_STRING"

export async function setup() {
    const connStr = await getSecret(
        "eventHubAccountConnectionString",
        DEVS_EVENT_HUB_CONNECTION_STRING
    )
    if (!connStr) {
        console.log(
            "no Azure EventHub connection string secret, skipping registration"
        )
        return
    }

    const producer = new EventHubProducerClient(connStr, "messages")
    registerMessageSink({
        name: "event hub",
        topicName: "*",
        ingest: async (topic, message, device) => {
            const batch = await producer.createBatch()
            const correlationId = device.sessionId
            const body = {
                context: {
                    deviceId: device.id,
                    deviceName: device.dev.name,
                    topic,
                },
                data: message,
            }
            if (
                !batch.tryAdd({
                    body,
                    correlationId,
                })
            ) {
                serverTelemetry()?.trackEvent({
                    name: "messages.eventhub.push.fail",
                })
            } else await producer.sendBatch(batch)
        },
    })
}
