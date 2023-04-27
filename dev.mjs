import dotenv from "dotenv"
import { promisify } from "util"
import { lookup } from "dns"
import { hostname } from "os"

const azure = process.argv.includes("--azure")

const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error

if (!azure) {
    const hn = hostname()
    const { address } = await promisify(lookup)(hn, 4)

    console.log("Using local web server and Azurite")
    console.log("- make sure to launch azurite with `yarn azurite`")
    console.log(
        `- Visual Studio Code connection string (localhost): 
        
${process.env.DEVS_CONNECTION_STRING}

`
    )
    console.log(
        `- Visual Studio Code connection string (local network):
        
${process.env.DEVS_CONNECTION_STRING.replace("127.0.0.1", address)}

`
    )
    console.log(`- Swagger: http://${process.env.WEBSITE_HOSTNAME}/swagger/`)
    console.log(
        `- More documentation at https://microsoft.github.io/devicescript/developer/cloud/gateway`
    )
    console.log(``)
}
import("./dist/src/index.js")
