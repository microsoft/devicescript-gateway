import { MqttClient, connect } from "mqtt" // import connect from mqtt
import { serverTelemetry } from "./azure/appinsights"
import { registerMessageSink } from "./messages"
import { getSecret } from "./secrets"
import { defaultPartition, getDevice } from "./storage"
import { sendJSON } from "./apidevices"
import { DeviceId } from "./schema"

let client: MqttClient
let serverUrl: string

export function mqttTopicPrefix(deviceid: DeviceId) {
    return client ? `devs/${deviceid.rowKey}` : undefined
}

export function mqttServer() {
    return serverUrl
}

export async function setup() {
    serverUrl = await getSecret(
        "mqttConnectionString",
        "DEVS_MQTT_SERVER_SECRET",
        "DEVS_MQTT_SERVER"
    )
    if (!serverUrl) {
        console.log("no MQTT connection string secret, skipping registration")
        return
    }

    console.log(`MQTT server: ${serverUrl}`)
    const telemetry = serverTelemetry()
    client = connect(serverUrl) // create a client

    // device to mqtt
    registerMessageSink({
        name: "mqtt",
        topicName: "*",
        ingest: async (topic, message, device) => {
            if (!client.connected) return

            const mqTopic = `${mqttTopicPrefix(device.dev)}/from/${topic}`
            client.publish(
                mqTopic,
                Buffer.from(JSON.stringify(message), "utf-8"),
                { qos: 0 },
                err => {
                    if (err) {
                        console.error(err)
                        telemetry?.trackException({ exception: err })
                    }
                }
            )
        },
    })

    // dispatch messages to devices
    client.on("connect", () => {
        // devs/deviceid/json/topic
        client.subscribe("devs/+/to/#", err => {
            if (err) {
                console.error(err)
                telemetry?.trackException({ exception: err })
            } else {
                console.log(`mqtt: subscribe to 'devs/+/to/#'`)
            }
        })
    })
    client.on("message", async function (topic, message) {
        const { deviceId, msgTopic } =
            /^devs\/(?<deviceId>.+?)\/to\/(?<msgTopic>.+)$/.exec(topic)
                ?.groups || {}
        if (!deviceId || !msgTopic) return // unknown topic
        const did: DeviceId = {
            partitionKey: defaultPartition,
            rowKey: deviceId,
        }
        const dev = await getDevice(did)
        if (!dev) return // unknown device

        await sendJSON(did, msgTopic, JSON.parse(message.toString("utf-8")))
    })
}
