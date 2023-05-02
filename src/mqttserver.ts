import { FastifyInstance } from "fastify"
import Aedes from "aedes"

export async function setup(server: FastifyInstance) {
    console.log(`MQTT server at /mqtt`)
    const aedes = new Aedes()
    server.get("/mqtt", { websocket: true }, async (conn, request) => {
        console.log("mqtt connection")
        aedes.handle(conn, request.raw)
    })
}
