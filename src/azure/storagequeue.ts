import { QueueServiceClient } from "@azure/storage-queue"
import { serverTelemetry } from "./appinsights"
import { registerMessageSink } from "../messages"
import { readStorageConnectionString } from "../storage"

const MESSAGE_TIME_TO_LIVE = 60

export async function setup() {
    const connStr = await readStorageConnectionString()
    if (!/QueueEndpoint=/.test(connStr)) {
        console.log(
            "no Azure Storage Queue connection string secret, skipping registration"
        )
        return
    }

    console.log("registering Azure Storage Queue message sink")
    const queueServiceClient = QueueServiceClient.fromConnectionString(connStr)
    await queueServiceClient.createQueue("messages")
    const queueClient = queueServiceClient.getQueueClient("messages")
    registerMessageSink({
        name: "storage queue",
        topicName: "*",
        ingest: async (topic, message, device) => {
            const correlationId = device.sessionId
            const body = {
                context: {
                    deviceId: device.id,
                    deviceName: device.dev.name,
                    topic,
                    correlationId,
                },
                data: message,
            }
            // JSON may generate invalid XML content so we default to base64 encoding instead
            const buffer = Buffer.from(JSON.stringify(body))
            const b64 = buffer.toString("base64")
            const resp = await queueClient.sendMessage(b64, {
                messageTimeToLive: MESSAGE_TIME_TO_LIVE,
            })
            if (resp.errorCode) {
                serverTelemetry()?.trackEvent({
                    name: "messages.storagequeue.push.fail",
                })
            }
        },
    })
}
