import { registerMessageSink } from "./messages"

export async function setup() {
    registerMessageSink({
        name: "environment variables",
        topicName: "env",
        ingest: async (message, device) => {
            
        },
    })
}
