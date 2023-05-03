#!/usr/bin/env zx
import "zx/globals"
import dotenv from "dotenv"
import { expand } from "dotenv-expand"
import { networkInterfaces } from "os"

const azure = process.argv.includes("--azure")

const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error

const port = process.env.PORT || (process.env.PORT = "7071")
const {
    CODESPACE_NAME,
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN,
    CODESANDBOX_HOST,
} = process.env
// GitHub codespaces
if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    process.env.WEBSITE_HOSTNAME = `${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    process.env.WEBSITE_PROTOCOL = "https"
    console.log(`GitHub Codespace detected...`)
    console.warn(
        `- make sure to change the visibility of port '${port}' to 'Public'`
    )
}
// Codesandbox
else if (CODESANDBOX_HOST) {
    process.env.WEBSITE_HOSTNAME = CODESANDBOX_HOST
    process.env.WEBSITE_PROTOCOL = "https"
    console.log(`Codesandbox.io detected...`)
}
// local dev
else if (!azure) {
    const address = (() => {
        const nis = networkInterfaces()
        for (const interfaceName in nis) {
            const interfaceDetails = nis[interfaceName]
            if (interfaceDetails) {
                for (const detail of interfaceDetails) {
                    if (!detail.internal && detail.family === "IPv4") {
                        return detail.address
                    }
                }
            }
        }
        return null
    })()
    process.env.WEBSITE_HOSTNAME = `${address}:${port}`
}

if (process.env.DEVS_MQTT_SERVER_DEV) {
    process.env.DEVS_MQTT_SERVER = `mqtt://${process.env.WEBSITE_HOSTNAME}:1883`
    //$`yarn aedes --credentials ./local.credentials.json adduser $DEVS_LOCAL_USER_NAME $DEVS_LOCAL_USER_PASSWORD`
    $`yarn aedes start --protos tcp ws --host 0.0.0.0 --broker-id devicescript-gateway --verbose --credentials ./local.credentials.json`
    console.log(`started development MQTT server`)
    console.warn(
        `- make sure to change the visibility of port '1883', '3000' to 'Public'`
    )
}

expand(out)

if (!azure) {
    $`yarn azurite`
    console.log(
        `- Visual Studio Code connection string: 
        
${process.env.DEVS_CONNECTION_STRING}

`
    )
    console.log(
        `- More documentation at https://microsoft.github.io/devicescript/developer/cloud/gateway`
    )
    console.log(``)
}
import("./dist/src/index.js")
