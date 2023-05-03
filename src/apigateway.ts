import { FastifyInstance } from "fastify"
import { mqttServer } from "./mqtt"
import { URL } from "url"

export async function initGatewayRoutes(server: FastifyInstance) {
    const url = mqttServer()
    const mqttUrl = url ? new URL(mqttServer()) : undefined
    server.get("/info", async req => {
        const res: any = {}
        if (url) {
            res.mqtt = {
                hostname: mqttUrl.hostname,
                path: mqttUrl.pathname,
                port: Number(mqttUrl.port) || 1883,
                username: process.env.DEVS_MQTT_USER_NAME,
                password: process.env.DEVS_MQTT_USER_PASSWORD,
            }
        }
        return res
    })
}
