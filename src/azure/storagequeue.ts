import { QueueServiceClient } from "@azure/storage-queue"
import { serverTelemetry } from "./appinsights"
import { registerMessageSink } from "../messages"
import { createSecretClient } from "../secrets"

export async function setup() {
    const secrets = createSecretClient()
    const connectionStringSecretName =
        process.env["DEVS_STORAGE_QUEUE_CONNECTION_STRING_SECRET"] ||
        "storageQueueAccountConnectionString"
    const connStrSecret = await secrets.getSecret(connectionStringSecretName)
    const connStr = connStrSecret.value
    if (!connStr) {
        console.log(
            "no Azure Storage Queue connection string secret, skipping registration"
        )
        return
    }

    const queueServiceClient = QueueServiceClient.fromConnectionString(connStr)
    const queueClient = queueServiceClient.getQueueClient("messages")
    registerMessageSink({
        name: "storage queue",
        ingest: async (message, device) => {
            const correlationId = device.sessionId
            const body = {
                context: {
                    deviceId: device.id,
                    deviceName: device.dev.name,
                    correlationId,
                },
                data: message,
            }
            // JSON may generate invalid XML content so we default to base64 encoding instead
            const buffer = Buffer.from(JSON.stringify(body))
            const b64 = buffer.toString("base64")
            const resp = await queueClient.sendMessage(b64)
            if (resp.errorCode) {
                serverTelemetry()?.trackEvent({
                    name: "messages.storagequeue.push.fail",
                })
            }
        },
    })
}
