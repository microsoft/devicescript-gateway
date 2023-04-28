import dotenv from "dotenv"
import { expand } from "dotenv-expand"
import { networkInterfaces } from "os"

const azure = process.argv.includes("--azure")

const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error

let protocol = "http"
const port = process.env.PORT || (process.env.PORT = "7071")
// codespace special handling
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env
console.log({ CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN })
if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    process.env.WEBSITE_HOSTNAME = `${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    protocol = "https"
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
    protocol = "http"
}

expand(out)

if (!azure) {
    console.log("Using local web server and Azurite")
    console.log("- make sure to launch azurite with `yarn azurite`")
    console.log(
        `- Visual Studio Code connection string (localhost): 
        
${process.env.DEVS_CONNECTION_STRING}

`
    )
    const { WEBSITE_HOSTNAME } = process.env
    if (!/^127.0.0.1/.test(WEBSITE_HOSTNAME))
        console.log(
            `- Visual Studio Code connection string:
        
${process.env.DEVS_CONNECTION_STRING.replace("http://127.0.0.1:7071", `${protocol}://${WEBSITE_HOSTNAME}`)}

`
        )
    console.log(
        `- More documentation at https://microsoft.github.io/devicescript/developer/cloud/gateway`
    )
    console.log(``)
}
import("./dist/src/index.js")
