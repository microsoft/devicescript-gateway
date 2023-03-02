import dotenv from "dotenv"
const out = dotenv.config({ path: "../.env" })
if (out.error)
    throw out.error
import "./dist/index.js"
