import dotenv from "dotenv"
import open from "open"
const out = dotenv.config({ path: "../.env" })
if (out.error)
    throw out.error
const url = process.env.DEVS_SWAGGER_URL
open(url)
