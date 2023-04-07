import dotenv from "dotenv"
const azure = process.argv.includes("--azure")

const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error

if (!azure) {
    console.log("Using local web server and Azurite")
    console.log("- make sure to launch azurite with `yarn azurite`")
    console.log(
        `- Visual Studio Code connection string: ${process.env.DEVS_CONNECTION_STRING}`
    )
    console.log(
        `- More documentation at https://microsoft.github.io/devicescript/developer/cloud/gateway`
    )
}
import("./dist/src/index.js")
