import dotenv from "dotenv"
const azure = process.argv.includes("--azure")
const out = dotenv.config({ path: azure ? "./.env" : "./local.env" })
if (out.error) throw out.error
import("./dist/src/index.js")
