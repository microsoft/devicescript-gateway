import { pubToDevice } from "./devutil"
import { registerMessageSink } from "./messages"
import { EnvironmentFromDevice } from "./schema"

export async function setup() {
    registerMessageSink({
        name: "environment variables",
        topicName: "env",
        ingest: async (message: EnvironmentFromDevice, device) => {
            const { envJSON } = device.dev
            const { fields } = message
            const env = JSON.parse(envJSON || "{}")
            if (fields?.length > 0) {
                for (const field of Object.keys(env)) {
                    if (!fields.includes(field)) delete env[field]
                }
            }
            await pubToDevice(device.id, {
                type: "env",
                env,
            })
        },
    })
}
