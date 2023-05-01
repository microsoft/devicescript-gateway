import { sendJSON } from "./apidevices"
import { registerMessageSink } from "./messages"
import { EnvironmentFromDevice } from "./schema"

export async function setup() {
    registerMessageSink({
        name: "environment variables",
        topicName: "env",
        ingest: async (topic: string, message: EnvironmentFromDevice, device) => {
            const { dev, id } = device
            const { envJSON } = dev
            const { fields } = message
            const env = JSON.parse(envJSON || "{}")
            if (fields?.length > 0) {
                for (const field of Object.keys(env)) {
                    if (!fields.includes(field)) delete env[field]
                }
            }
            await sendJSON(id, "env", env)
        },
    })
}
