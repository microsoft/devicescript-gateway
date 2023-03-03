import dotenv from "dotenv"
const out = dotenv.config()
if (out.error)
    throw out.error
import "./dist/index.js"
