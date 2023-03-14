import Aedes from "aedes"
import { createServer } from "http"
import ws from "websocket-stream"
import { emitter } from "./mq"

export function setupMqtt() {
    const port = 8888
    const aedes = new Aedes({
        mq: emitter,
    })

    const server = createServer()
    ws.createServer({ server }, aedes.handle as any)
    server.listen(port, function () {
        console.log("mqtt websocket server listening on port ", port)
    })
}
