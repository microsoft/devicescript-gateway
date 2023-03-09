import { EventHubProducerClient } from "@azure/event-hubs"
import { serverTelemetry } from "./appinsights"
import { messageSinks } from "./messages"
import { createSecretClient } from "./vault"

export async function setup() {
    const secrets = createSecretClient()
    const connectionStringSecretName =
        process.env["DEVS_EVENT_HUB_CONNECTION_STRING_SECRET"] ||
        "eventHubAccountConnectionString"
    const connStrSecret = await secrets.getSecret(connectionStringSecretName)
    const connStr = connStrSecret.value
    if (!connStr) throw new Error("event hub connection string is empty")

    const producer = new EventHubProducerClient(connStr, "messages")
    messageSinks.push(async message => {
        // Prepare a batch of three events.
        const batch = await producer.createBatch()
        if (!batch.tryAdd({ body: message }))
            serverTelemetry().trackEvent({
                name: "messages.eventhub.push.fail",
            })
        else await producer.sendBatch(batch)
    })
}
