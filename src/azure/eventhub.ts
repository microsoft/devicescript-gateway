import { EventHubProducerClient } from "@azure/event-hubs"
import { serverTelemetry } from "./appinsights"
import { registerMessageSink } from "../messages"
import { createSecretClient } from "../secrets"

export async function setup() {
    const secrets = createSecretClient()
    const connectionStringSecretName =
        process.env["DEVS_EVENT_HUB_CONNECTION_STRING_SECRET"] ||
        "eventHubAccountConnectionString"
    const connStrSecret = await secrets.getSecret(connectionStringSecretName)
    const connStr = connStrSecret.value
    if (!connStr) {
        console.log(
            "no EventHub connection string secret, skipping registration"
        )
        return
    }

    const producer = new EventHubProducerClient(connStr, "messages")
    registerMessageSink({
        name: "event hub",
        ingest: async (message, device) => {
            const batch = await producer.createBatch()
            const correlationId = device.sessionId
            const body = {
                context: {
                    deviceId: device.id,
                    deviceName: device.dev.name,
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
