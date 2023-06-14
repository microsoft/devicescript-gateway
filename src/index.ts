import { initHubRoutes } from "./apidevices"
import { initScriptRoutes } from "./apiscripts"
import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import fastifyBasicAuth from "@fastify/basic-auth"
import fastifyCors from "@fastify/cors"
import websocketPlugin from "@fastify/websocket"
import { selfHost, selfUrl, throwStatus } from "./util"
import fastifyStatic from "@fastify/static"
import * as mq from "./mq"
import { wsskInit } from "./wssk"
import { fwdSockInit } from "./fwdsock"

import { getSecret } from "./secrets"
import { generateOpenApiSpec } from "./swagger/openapi"
import { setup as appInsightsSetup, serverTelemetry } from "./azure/appinsights"
import { setup as eventHubSetup } from "./azure/eventhub"
import { setup as storageSetup, defaultPartition } from "./storage"
import { setup as envSetup } from "./env"
import { setup as storageQueueSetup } from "./azure/storagequeue"
import { setup as mqttSetup } from "./mqtt"
import { initGatewayRoutes } from "./apigateway"

async function initAuth(server: FastifyInstance) {
    console.log(`starting gateway...`)
    const passwordsSecret = await getSecret(
        "passwords",
        "DEVS_PASSWORDS"
    )
    if (!passwordsSecret) throw new Error("passwords is empty")

    const passwords = passwordsSecret
        .split(/,/)
        .map(s => s.trim())
        .filter(s => /^\w+:.+/.test(s))

    server.register(fastifyBasicAuth, {
        validate: async (
            username: string,
            password: string,
            req: FastifyRequest,
            _reply: FastifyReply
        ) => {
            if (passwords.indexOf(username + ":" + password) < 0)
                return new Error("invalid user/pass")
            else {
                req.partition = defaultPartition
                return undefined
            }
        },
        authenticate: {
            realm: "DeviceScript-Gateway",
        },
    })
    await server.after()
}

const swaggerPresets = `
window.onload = function () {
    window.ui = SwaggerUIBundle({
        url: "/swagger/api.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis]
    })
}
`

async function main() {
    await appInsightsSetup()

    const server = fastify({
        disableRequestLogging: true,
        maxParamLength: 2048,
        logger: {
            level: "debug",
            transport: {
                target: "pino-pretty",
                options: {
                    // translateTime: "HH:MM:ss Z",
                    ignore: "pid,hostname",
                },
            },
        },
    })

    mq.setErrorHandler((topic, err) => {
        server.log.error(`sub(${topic}) error: ${err.message}`, err)
    })

    server.decorateRequest("iotuser", "")
    server.decorateRequest("self", "")

    server.register(fastifyCors, { origin: "*" })
    server.register(websocketPlugin)

    server.get("/swagger/swagger-initializer.js", async (req, resp) => {
        resp.type("application/javascript").send(swaggerPresets)
    })
    server.get("/swagger/api.json", async (req, resp) => {
        const spec = generateOpenApiSpec()
        spec.schemes = [selfUrl().replace(/:.*/, "")]
        spec.host = selfHost()
        return spec
    })
    server.register(fastifyStatic, {
        root: require("swagger-ui-dist").absolutePath(),
        prefix: "/swagger/",
    })

    server.setNotFoundHandler(function (req, reply) {
        req.log.info(`not found: ${req.url}`)
        reply.code(404).type("text/plain").send("Page not found, sorry.")
    })

    /*
    const origHandler = server.errorHandler
    server.setErrorHandler((error, request, reply) => {
        if (error.statusCode == 404) reply.callNotFound()
        else origHandler(error, request, reply)
    })
    */

    server.addHook("preHandler", (req, resp, done) => {
        req.log.info(`${req.method} ${req.url}`)
        done()
    })

    await storageSetup()
    await eventHubSetup()
    await storageQueueSetup()
    await mqttSetup()
    await envSetup()
    await initAuth(server)
    await wsskInit(server)
    await fwdSockInit(server)

    server.get("/", async (req, resp) => {
        resp.type("text/html")
        return `<html>
        <head>
            <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,300italic,700,700italic">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.css">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/milligram/1.4.1/milligram.css">
            <style>
                body {
                    margin: 1rem;
                }
            </style>
        </head>
        <body>
        <h1>Development DeviceScript Gateway</h1>
        <ul>
            <li><a href='./swagger/'>OpenAPI dashboard (swagger)</a>.</li>
            <li><a href='https://microsoft.github.io/devicescript/developer/development-gateway/gateway'>Documentation</a></li>
            ${
                process.env.DEVS_MQTT_SERVER
                    ? `<li>MQTT server: ${process.env.DEVS_MQTT_SERVER}</li>`
                    : ""
            }
        </ul>
        </body>
        </html>`
    })

    server.register(
        async server => {
            server.addHook("onRequest", server.basicAuth)

            await initHubRoutes(server)
            await initScriptRoutes(server)
            await initGatewayRoutes(server)

            server.all("*", async req => {
                throwStatus(404, "no such API")
            })
        },
        { prefix: "/api" }
    )

    await server.after()

    const port = parseInt(process.env["PORT"] || "") || 7071
    const host = "0.0.0.0"
    server.listen({ port, host }, err => {
        if (err) {
            serverTelemetry()?.trackException({ exception: err })
            console.error(err)
            process.exit(1)
        }
    })
}

main()
