import { FastifyInstance } from "fastify"
import { mqttServer } from "./mqtt"

export async function initGatewayRoutes(server: FastifyInstance) {
    server.get("/info", async req => {
        return {
            mqttServer: mqttServer(),
        }
    })
}
