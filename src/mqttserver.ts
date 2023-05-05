import { FastifyInstance } from "fastify"
import Aedes from "aedes"
import mqemitter from "mqemitter"
import { randomBytes } from "crypto"

export async function setup(server: FastifyInstance) {
    console.log(`start MQTT server at /mqtt`)
    const aedes = new Aedes({
        mq: mqemitter({}),
        id: "devicescript_gateway_" + randomBytes(8).toString("base64url"),
    })
    server.get("/mqtt", { websocket: true }, (conn, request) => {
        console.log(`mqtt: open`)
        const stream = request.socket
        const req = request.raw
        aedes.handle(stream, req)
        req.on("close", () => {
            console.log("mqttserver: close")
        })
    })
}
