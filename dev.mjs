import dotenv from "dotenv"
import { networkInterfaces } from "os"

const azure = process.argv.includes("--azure")

const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error

if (!azure) {
    // resolve local network ip address
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

    console.log("Using local web server and Azurite")
    console.log("- make sure to launch azurite with `yarn azurite`")
    console.log(
        `- Visual Studio Code connection string (localhost): 
        
${process.env.DEVS_CONNECTION_STRING}

`
    )
    if (address && address !== "127.0.0.1")
        console.log(
            `- Visual Studio Code connection string (local network):
        
${process.env.DEVS_CONNECTION_STRING.replace("127.0.0.1", address)}

`
        )
    console.log(
        `- More documentation at https://microsoft.github.io/devicescript/developer/cloud/gateway`
    )
    console.log(``)
}
import("./dist/src/index.js")
