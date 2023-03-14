import { EventHubProducerClient } from "@azure/event-hubs"
import { serverTelemetry } from "./appinsights"
import { createSecretClient } from "./vault"
import * as mq from "./mq"
import { DeviceId } from "./schema"
import * as storage from "./storage"

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

    mq.sub("dev/+/+/from/#", async (message: { topic: string }) => {
        const topic = message.topic
        const { partitionKey, rowKey } =
            /^dev\/(?<partitionKey>[^/]+)\/(?<rowKey>[^/]+)\/from\//.exec(topic)
                .groups as object as DeviceId
        const device = await storage.getDevice({ partitionKey, rowKey })

        const batch = await producer.createBatch()
        const body = {
            context: {
                deviceId: device.rowKey,
                deviceName: device.name,
            },
            data: message,
        }
        if (
            !batch.tryAdd({
                body,
            })
        ) {
            serverTelemetry()?.trackEvent({
                name: "messages.eventhub.push.fail",
            })
        } else await producer.sendBatch(batch)
    })
}
