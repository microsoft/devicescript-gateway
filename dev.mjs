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
    console.warn(
        `------------------------------------------------------------------`
    )
    console.warn(
        `- MAKE SURE TO CHANGE THE VISIBILITY OF PORT '${port}' TO 'Public'`
    )
    console.warn(
        `------------------------------------------------------------------`
    )
}
// Codesandbox
else if (CODESANDBOX_HOST) {
    process.env.WEBSITE_HOSTNAME = CODESANDBOX_HOST
    process.env.WEBSITE_PROTOCOL = "https"
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

expand(out)

if (!azure) {
    $`yarn azurite`
    console.log(
        `- Visual Studio Code Extension connection string: 
        
${process.env.DEVS_CONNECTION_STRING}

`
    )
    console.log(``)
}
import("./dist/src/index.js")
