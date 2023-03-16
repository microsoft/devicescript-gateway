import { FastifyInstance } from "fastify"
import * as crypto from "crypto"
import * as storage from "./storage"
import { getDeviceFromFullPath } from "./apidevices"
import { DeviceInfo, FromDeviceMessage, ToDeviceMessage } from "./schema"
import { websockDataToBuffer } from "./wssk"
import { runInBg } from "./util"
import {
    pubToDevice,
    subFromDevice,
    isDeviceConnected,
    fullDeviceId,
} from "./devutil"
import type { SideDeviceMessage } from "./interop"

function sha256(data: string) {
    const s = crypto.createHash("sha256")
    s.update(data, "utf-8")
    return s.digest().toString("hex")
}

function tokenSig(di: DeviceInfo, time: number) {
    const hexkey = Buffer.from(di.key, "base64").toString("hex")
    const tok = `${di.partitionKey}.${di.rowKey}.${hexkey}.${time}`
    return sha256(tok)
}

const tokenValiditySeconds = 600

function nowSeconds() {
    return Math.floor(Date.now() / 1000)
}

export function fwdSockConnSettings(
    dev: DeviceInfo,
    route: "devfwd" | "devlogs"
) {
    const n = nowSeconds()
    const protocol = "mgmt-" + n + "-" + tokenSig(dev, n)
    const url =
        storage.selfUrl().replace("http", "ws") +
        "/" +
        route +
        "/" +
        fullDeviceId(dev)

    return {
        url,
        protocol,
        protocols: protocol, // TODD remove me (typo in jacdac-docs)
        expires: (n + tokenValiditySeconds) * 1000,
    }
}

function noop() {}

export async function fwdSockInit(server: FastifyInstance) {
    await fwdSockInitRoute(server, "devfwd", {
        forwarding: true,
        logging: true,
    })
    await fwdSockInitRoute(server, "devlogs", { logging: true })
}

export async function fwdSockInitRoute(
    server: FastifyInstance,
    route: "devfwd" | "devlogs",
    fwdMsg: { forwarding?: boolean; logging?: boolean }
) {
    const { forwarding, logging } = fwdMsg
    server.get(
        `/${route}/:partId/:deviceId`,
        { websocket: true },
        async (conn, req) => {
            let closed = false
            let log = req.log
            let dev: DeviceInfo
            let unsub = noop

            try {
                dev = await getDeviceFromFullPath(req)
            } catch (e: any) {
                return error(e.message)
            }

            log = server.log.child({ mgmt: dev.rowKey })

            const m = /^mgmt-(\d+)-([a-f0-9]+)$/i.exec(conn.socket.protocol)
            if (!m) return error("bad proto-key")
            const time = parseFloat(m[1])
            if (nowSeconds() > time + tokenValiditySeconds)
                return error("token expired")
            if (tokenSig(dev, time) != m[2]) return error("bad sig")

            if (!(await isDeviceConnected(dev)))
                return error(`device ${dev.partitionKey}/${dev.rowKey}  not connected`)

            function enableFwd() {
                if (closed) return
                runInBg(
                    log,
                    `enfwd${route}`,
                    pubToDevice(dev, { type: "setfwd", ...fwdMsg })
                )
                setTimeout(enableFwd, 5000)
            }
            enableFwd()
            unsub = await subFromDevice(dev, async (msg: FromDeviceMessage) => {
                if (forwarding && msg.type === "frame")
                    conn.socket.send(Buffer.from(msg.payload64, "base64"))
                if (logging && msg.type !== "frame") {
                    switch (msg.type) {
                        case "logs":
                        case "uploadBin":
                        case "uploadJson":
                            conn.socket.send(msg as SideDeviceMessage)
                            break
                    }
                }
            })
            if (forwarding)
                conn.socket.on("message", (msg, isBin) => {
                    try {
                        if (
                            !isBin ||
                            conn.socket.readyState !== conn.socket.OPEN
                        )
                            return

                        const frame = websockDataToBuffer(msg)
                        if (frame.length > 256) return error("too large frame")

                        runInBg(
                            log,
                            "send-frame",
                            pubToDevice(dev, {
                                type: "frameTo",
                                payload64: frame.toString("base64"),
                            })
                        )
                    } catch (e: any) {
                        log.error(`message handler: ${e.message}`)
                    }
                })
            if (logging)
                conn.socket.on("message", (msg, isBin) => {
                    try {
                        if (
                            isBin ||
                            conn.socket.readyState !== conn.socket.OPEN
                        )
                            return
                        console.log(`received...`)
                        console.log(msg)
                    } catch (e: any) {
                        log.error(`message handler: ${e.message}`)
                    }
                })
            conn.socket.on("error", err => {
                log.warn(`websock error: ${err.message}`)
                closeIt()
            })

            conn.socket.on("close", (code, reason) => {
                if (!closed) {
                    log.info(`socket closed ${code}`)
                    closed = true
                    closeIt()
                }
            })

            function error(msg: string) {
                log.warn(`error, closing socket: ${msg}`)
                closeIt(msg)
            }

            function closeIt(msg?: string) {
                const f = unsub
                unsub = noop
                f()
                pubToDevice(dev, {
                    type: "setfwd",
                    forwarding: false,
                    logging: false,
                })
                if (!closed) {
                    closed = true
                    conn.socket.close(1000, msg || "") // just in case
                }
            }
        }
    )
}
