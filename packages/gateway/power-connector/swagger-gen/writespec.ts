import { writeFileSync } from "fs"
import { jacdacSpec } from "./powerjacdac"

function main() {
    const spec = jacdacSpec()
    writeFileSync("apiDefinition.swagger.json", JSON.stringify(spec, null, 2))
}
main()
