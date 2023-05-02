import { FastifyInstance } from "fastify"
import Aedes from "aedes"

export async function setup(server: FastifyInstance) {
    console.log(`MQTT server at /mqtt`)
    const aedes = new Aedes()
    server.get("/mqtt", (request, reply) => {
        console.log(`connecting mqtt client`)
        const client = aedes.handle(request.socket, request.raw)
        request.raw.on("close", () => {
            client.close()
        })
    })
}
