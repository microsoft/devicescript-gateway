import { EventHubProducerClient } from "@azure/event-hubs"
import { telemetrySinks } from "./telemetry"
import { createSecretClient } from "./vault"

export async function setup() {
    const secrets = createSecretClient()
    const connectionStringSecretName =
        process.env["DEVS_EVENT_HUB_CONNECTION_STRING_SECRET"] ||
        "eventHubAccountConnectionString"
    const connStrSecret = await secrets.getSecret(connectionStringSecretName)
    const connStr = connStrSecret.value
    if (!connStr) throw new Error("event hub connection string is empty")

    const eventHubName = process.env["DEVS_EVENT_HUB_NAME"]
    if (!eventHubName) throw new Error("event hub name is empty")

    const producer = new EventHubProducerClient(connStr, eventHubName)

    telemetrySinks.push(async (part, entries) => {
        // Prepare a batch of three events.
        const batch = await producer.createBatch()
        entries.forEach(entry => batch.tryAdd({ body: entry }))
        await producer.sendBatch(batch)
    })
}
