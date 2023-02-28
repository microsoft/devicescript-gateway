const fs = require("fs")
fs.readFileSync(".env", "utf-8").replace(/^(\w+)=(".*")/mg, (_, n, v) => {
    process.env[n] = JSON.parse(v)
})
require("./dist/index.js")
