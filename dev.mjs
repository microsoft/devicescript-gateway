import dotenv from "dotenv"
import { expand } from "dotenv-expand"
import { networkInterfaces } from "os"

const azure = process.argv.includes("--azure")

const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error

const port = process.env.PORT || (process.env.PORT = "7071")
// codespace special handling
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env
if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    process.env.WEBSITE_HOSTNAME = `${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    process.env.WEBSITE_PROTOCOL = "https"
    console.log(`GitHub Codespace environment detected...`)
    console.warn(`- make sure to change the visibility of port '${port}' to 'Public'`)
} else if (!azure) {
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
    console.log("- make sure to launch azurite with `yarn azurite`")
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
