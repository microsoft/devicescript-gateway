import { FastifyBaseLogger, FastifyInstance } from "fastify"
import * as crypto from "crypto"
import { getDeviceFromFullPath, MAX_WSSK_SIZE } from "./apidevices"
import {
    DeviceId,
    DeviceInfo,
    FromDeviceMessage,
    ToDeviceMessage,
    zeroDeviceStats,
} from "./schema"
import { displayName, runInBg, selfHost, tryParseJSON } from "./util"
import { fullDeviceId, pubFromDevice, subToDevice } from "./devutil"
import {
    contextTagKeys,
    devsTelemetry,
    logLineToTraceTelemetry,
    serverTelemetry,
} from "./azure/appinsights"
import {
    EventTelemetry,
    ExceptionTelemetry,
    MetricTelemetry,
    Telemetry,
    TelemetryType,
    TraceTelemetry,
} from "applicationinsights/out/Declarations/Contracts"
import {
    DebugInfo,
    WsskCmd,
    WsskDataType,
    WsskStreamingType,
    parseStackFrame,
    IMAGE_MIN_LENGTH,
    checkMagic,
} from "./interop"
import { ingestLogs, ingestMessage } from "./messages"
import {
    deviceStats,
    getDevice,
    getScriptBody,
    resolveScriptBodyFromSha,
    updateDevice,
} from "./storage"

const JD_AES_CCM_TAG_BYTES = 4
const JD_AES_CCM_LENGTH_BYTES = 2
const JD_AES_CCM_NONCE_BYTES = 15 - JD_AES_CCM_LENGTH_BYTES

const JD_AES_KEY_BYTES = 32
const JD_AES_BLOCK_BYTES = 16

const JD_ENCSOCK_MAGIC = 0xcee428ca

function toDoubleArray(buf: Buffer) {
    const r: number[] = []
    for (let i = 0; i < buf.length - 7; i += 8) {
        r.push(buf.readDoubleLE(i))
    }
    return r
}

function decodeString0(buf: Buffer): [string, Buffer] {
    let i = 0
    while (i < buf.length) {
        if (buf[i] == 0) break
        i++
    }
    return [buf.slice(0, i).toString("utf-8"), buf.slice(i + 1)]
}

function encodeDoubleArray(arr: number[]) {
    const r = Buffer.alloc(arr.length * 8)
    arr.forEach((v, i) => r.writeDoubleLE(v, i * 8))
    return r
}

function encodeU32Array(arr: number[]) {
    const r = Buffer.alloc(arr.length * 4)
    arr.forEach((v, i) => r.writeUInt32LE(v, i * 4))
    return r
}

function encodeString0(s: string) {
    return Buffer.from(s + "\u0000", "utf-8")
}

function noop() {}

const bytecodeAlign = 32
const bytecodeMaxPkt = 128 + 64

const deployTimeoutCache: Record<string, number> = {}
const deployNumFailCache: Record<string, number> = {}

function splitLines(prevBuf: Buffer, buf: Buffer) {
    const lines: string[] = []
    if (prevBuf) buf = Buffer.concat([prevBuf, buf])
    let beg = 0
    for (let i = 0; i < buf.length; ++i) {
        if (buf[i] == 10) {
            const slc = buf.slice(beg, i)
            if (slc.length) lines.push(slc.toString("utf-8"))
            beg = i + 1
        }
    }
    buf = buf.slice(beg)
    return { buf, lines }
}

export class ConnectedDevice {
    lastMsg = 0
    tickNo = 0
    stats = zeroDeviceStats()

    readonly sessionId = crypto.randomBytes(32).toString("base64url")

    private deployId: string
    private deployVersion: number
    private deployBuffer: Buffer
    private deployHash: Buffer
    private deployPtr = 0
    private deployCmd: WsskCmd = <WsskCmd>0
    streamingMask = WsskStreamingType.DefaultMask

    private lastDbgInfo: DebugInfo

    private lastExnBuffer: Buffer
    private exnBuffer: Buffer
    private exnLines: string[]
    private logBuffer: Buffer

    private deployedHash: Buffer

    sendMsg = async (msg: Buffer) => {}
    private unsub = noop
    private tickInt: any
    constructor(
        public readonly dev: DeviceInfo,
        public readonly meta: {
            ip: string
        },
        public log: FastifyBaseLogger
    ) {
        this.trackEvent("open", { properties: { ip: this.meta.ip } })
    }

    get id(): DeviceId {
        return this.dev
    }

    get path() {
        return fullDeviceId(this.id)
    }

    private get deployTimeout() {
        return deployTimeoutCache[this.path] || 0
    }
    private set deployTimeout(v: number) {
        deployTimeoutCache[this.path] = v
    }

    private get deployNumFail() {
        return deployNumFailCache[this.path] || 0
    }
    private set deployNumFail(v: number) {
        deployNumFailCache[this.path] = v
    }

    private async notify(payload: FromDeviceMessage) {
        this.log.debug(`notify ${JSON.stringify(payload)}`)
        await pubFromDevice(this.id, payload)
    }
    warn(msg: string) {
        this.notify({ type: "warning", message: msg })
        this.log.warn(msg)
        this.trackWarning(msg)
    }

    private setDeploy(buf: Buffer) {
        this.deployBuffer = buf
        const s = crypto.createHash("sha256")
        s.update(this.deployBuffer)
        this.deployHash = s.digest()
        this.trackEvent("deploy.set")
    }

    private async ensureDeployed() {
        if (this.deployTimeout > Date.now()) return
        this.deployPtr = 0
        this.deployFail() // set timeout
        this.log.debug(`deploying ${this.deployHash.toString("hex")}`)
        await this.sendDeployCmd(WsskCmd.GetHash)
    }

    private deployFail() {
        this.trackEvent("deploy.fail")
        this.deployCmd = <WsskCmd>0
        this.deployNumFail++
        this.deployTimeout =
            Date.now() + (2 + Math.min(this.deployNumFail, 20)) * 10 * 1000
    }

    private isDeployCmd(cmd: number) {
        return [
            WsskCmd.GetHash,
            WsskCmd.DeployStart,
            WsskCmd.DeployWrite,
            WsskCmd.DeployFinish,
        ].includes(cmd)
    }

    private async deployStep(cmd: number, payload: Buffer) {
        if (
            cmd == WsskCmd.Error ||
            (this.isDeployCmd(cmd) && cmd != this.deployCmd)
        ) {
            if (this.deployCmd) {
                this.warn(`deploy failed: ${cmd}`)
                this.deployFail()
            } else {
                this.log.debug(`ignored deploy ${cmd}`)
            }
            return true
        } else if (cmd == this.deployCmd) {
            switch (cmd) {
                case WsskCmd.GetHash: {
                    this.log.debug(`got hash`)
                    const isSecondTry = this.deployedHash == this.deployHash
                    this.deployedHash = payload.slice(0, 32)
                    if (this.deployedHash.equals(this.deployHash)) {
                        if (isSecondTry) {
                            this.trackEvent("deploy.secondtry")
                            this.log.info("re-check hash OK")
                        } else {
                            this.trackEvent("deploy.same")
                            this.log.info(
                                `already have ${this.deployHash.toString(
                                    "hex"
                                )}`
                            )
                        }
                        this.deployCmd = <WsskCmd>0
                        this.deployNumFail = 0
                        this.deployTimeout = 0
                    } else {
                        if (isSecondTry) {
                            this.warn("deploy hash check failed")
                            this.deployFail()
                        } else {
                            this.trackEvent("deploy.start")
                            await this.sendDeployCmd(
                                WsskCmd.DeployStart,
                                encodeU32Array([this.deployBuffer.length])
                            )
                        }
                    }
                    break
                }
                case WsskCmd.DeployStart:
                case WsskCmd.DeployWrite: {
                    let sz = this.deployBuffer.length - this.deployPtr
                    if (sz > 0) {
                        sz = Math.min(sz, bytecodeMaxPkt)
                        const chunk = this.deployBuffer.slice(
                            this.deployPtr,
                            this.deployPtr + sz
                        )
                        this.log.debug(
                            `deploy at ${this.deployPtr}/${this.deployBuffer.length}, ${sz} bytes`
                        )
                        this.deployPtr += sz
                        await this.sendDeployCmd(WsskCmd.DeployWrite, chunk)
                    } else {
                        this.trackEvent("deploy.success")
                        this.log.debug(`finish deploy ${this.deployPtr} bytes`)
                        await this.sendDeployCmd(WsskCmd.DeployFinish)
                    }
                    break
                }
                case WsskCmd.DeployFinish:
                    this.log.info(`deployed ${this.deployHash.toString("hex")}`)
                    this.deployedHash = this.deployHash
                    this.deployTimeout = 0
                    await this.ensureDeployed() // re-check the hash
                    break
            }
            return true
        } else {
            return false
        }
    }

    private async sendCmd(cmd: WsskCmd, ...payloads: Buffer[]) {
        const msg = Buffer.concat([Buffer.from([cmd]), ...payloads])
        await this.sendMsg(msg)
    }

    private async sendDeployCmd(cmd: WsskCmd, ...payloads: Buffer[]) {
        this.deployCmd = cmd
        return this.sendCmd(cmd, ...payloads)
    }

    private async sendPayload(tp: WsskDataType, topic: string, data: Buffer) {
        this.stats.c2d++
        const tps = WsskDataType[tp]
        this.trackEvent("send_" + tps)
        const payload = Buffer.concat([encodeString0(topic), data])
        if (payload.length > MAX_WSSK_SIZE)
            this.warn(
                `${tps} payload too large (${payload.length}, only ${MAX_WSSK_SIZE} allowed; topic=${topic})`
            )
        else await this.sendCmd(WsskCmd.C2d, Buffer.from([tp]), payload)
    }

    private async setStreaming(mask: WsskStreamingType) {
        const d = Buffer.alloc(2)
        d.writeUInt16LE(mask, 0)
        await this.sendCmd(WsskCmd.SetStreaming, d)
    }

    private async toDevice(msg: ToDeviceMessage) {
        switch (msg.type) {
            case "sendJson":
                await this.sendPayload(
                    WsskDataType.JSON,
                    msg.devTopic,
                    Buffer.from(JSON.stringify(msg.value), "utf-8")
                )
                break
            case "sendBin":
                await this.sendPayload(
                    WsskDataType.Binary,
                    msg.devTopic,
                    Buffer.from(msg.payload64, "base64")
                )
                break
            case "frameTo":
                await this.sendCmd(
                    WsskCmd.JacdacPacket,
                    Buffer.from(msg.payload64, "base64")
                )
                break
            case "setfwd": {
                const setBit = (
                    v: boolean | undefined,
                    m: WsskStreamingType
                ) => {
                    if (v === undefined) return
                    if (v) this.streamingMask |= m
                    else this.streamingMask &= ~m
                }
                setBit(msg.forwarding, WsskStreamingType.Jacdac)
                setBit(msg.logging, WsskStreamingType.Dmesg)
                setBit(msg.exceptions, WsskStreamingType.Exceptions)
                await this.setStreaming(this.streamingMask)
                break
            }
            case "ping":
                await this.sendCmd(
                    WsskCmd.PingDevice,
                    Buffer.from(msg.payload64 || "", "base64")
                )
                break
            case "update":
                await this.syncScript(msg.dev)
                break
        }
    }

    async syncScript(d: DeviceInfo) {
        if (!d.scriptId) return

        if (
            this.deployBuffer &&
            d.scriptId == this.deployId &&
            d.scriptVersion == this.deployVersion
        ) {
            // no need to set it
        } else {
            this.deployBuffer = null
            this.deployHash = null
            try {
                const body = await getScriptBody(d.scriptId, d.scriptVersion)
                const tmp = Buffer.from(body.program.binary.hex, "hex")
                if (tmp.length < IMAGE_MIN_LENGTH)
                    this.warn(`compiled program too short`)
                else {
                    if (!checkMagic(tmp)) {
                        this.warn(
                            `compiled program bad magic ${tmp
                                .slice(0, 8)
                                .toString("hex")}`
                        )
                    } else this.setDeploy(tmp)
                }
            } catch (e: any) {
                serverTelemetry()?.trackException({ exception: e })
            }
        }

        if (
            this.deployBuffer &&
            (!this.deployedHash || !this.deployedHash.equals(this.deployHash))
        )
            await this.ensureDeployed()
    }

    async connected() {
        this.trackEvent("connect")
        this.unsub = await subToDevice(this.id, this.toDevice.bind(this))
        this.tickInt = setInterval(() => {
            runInBg(this.log, "tick", this.fastTick())
        }, 272)
        await this.setStreaming(this.streamingMask)
        await this.syncScript(await getDevice(this.id))
    }

    async fromDevice(msg: Buffer) {
        this.lastMsg = Date.now()
        if (msg.length < 1) return this.warn("short frame")

        const cmd = msg[0]
        const payload = msg.slice(1)
        switch (cmd) {
            case WsskCmd.D2c: {
                this.stats.d2c++
                const tp: WsskDataType = msg[1]
                const data = msg.slice(2)

                switch (tp) {
                    case WsskDataType.Binary:
                        this.trackEvent("uploadBin")
                        const [topic, payload] = decodeString0(data)
                        this.log.debug(
                            `uploadBin: ${topic}: ${payload.toString("hex")}`
                        )
                        await this.notify({
                            type: "uploadBin",
                            topic,
                            payload64: payload.toString("base64"),
                        })
                        break
                    case WsskDataType.JSON: {
                        const [topic, payload] = decodeString0(data)
                        let v: any
                        try {
                            v = JSON.parse(payload.toString("utf-8"))
                        } catch {}
                        if (v === undefined)
                            this.warn(`invalid JSON in D2C(${topic})`)
                        else {
                            this.trackEvent("uploadJson")
                            this.log.debug(
                                `uploadJSON: ${topic}: ${payload.toString(
                                    "utf-8"
                                )}`
                            )
                            await Promise.all([
                                ingestMessage(topic, v, this),
                                this.notify({
                                    type: "uploadJson",
                                    topic,
                                    value: v,
                                }),
                            ])
                        }
                        break
                    }
                    default:
                        this.warn(`invalid data type ${tp} in D2C`)
                        break
                }
                break
            }
            case WsskCmd.PingDevice:
                this.log.debug(`pong`)
                await this.notify({
                    type: "pong",
                    payload64: payload.toString("base64"),
                })
                break
            case WsskCmd.PingCloud:
                this.log.debug(`ping`)
                this.sendCmd(WsskCmd.PingCloud, payload)
                break
            case WsskCmd.JacdacPacket:
                const flen = payload[2] + 12
                if (flen > payload.length) return this.warn("frame too short")
                this.log.debug(`frame ${flen} bytes`)
                await this.notify({
                    type: "frame",
                    payload64: payload.slice(0, flen).toString("base64"),
                })
                break
            case WsskCmd.ExceptionReport: {
                const { buf, lines } = splitLines(this.exnBuffer, payload)
                this.exnBuffer = buf
                if (this.exnLines) this.exnLines.push(...lines)
                else this.exnLines = lines
                break
            }
            case WsskCmd.Dmesg: {
                const { buf, lines } = splitLines(this.logBuffer, payload)
                this.logBuffer = buf
                if (lines.length) {
                    await Promise.all([
                        ingestLogs(lines, this),
                        this.notify({ type: "logs", logs: lines }),
                    ])
                }
                break
            }
            default:
                if (!(await this.deployStep(cmd, payload)))
                    this.warn(`unknown cmd ${cmd.toString(16)}`)
        }
    }

    closed() {
        this.trackEvent("closed")
        const f = this.unsub
        this.unsub = noop
        f()
        if (this.tickInt) {
            clearInterval(this.tickInt)
            this.tickInt = undefined
        }
    }

    private async parseException(logs: string[]) {
        let sha = ""
        let startIdx = 0
        let exnName = ""
        let idx = 0
        for (const l of logs) {
            let m = /DevS-SHA256:\s+([a-f0-9]{64})/.exec(l)
            if (m) sha = m[1].toLowerCase()
            m = /^[\*!] Exception:\s*(\S+)/.exec(l)
            if (m) {
                startIdx = idx
                exnName = m[1]
            }
            idx++
        }

        if (sha) {
            if (this.lastDbgInfo?.binarySHA256 !== sha) {
                this.lastDbgInfo = null
                try {
                    const body = await resolveScriptBodyFromSha(
                        this.dev.partitionKey,
                        sha
                    )
                    this.lastDbgInfo = body?.program
                } catch {}
            }
        }

        logs = logs.map(l =>
            parseStackFrame(this.lastDbgInfo, l).markedLine.replace(
                /\u001b\[[\d;]+m/g,
                ""
            )
        )

        const stack = logs
            .slice(startIdx)
            .filter(l => l.startsWith("*") || l.startsWith("!"))
            .map(l => l.slice(1))
        let message = ""
        for (const l of stack) {
            const m = /^\s+message: (.*)/.exec(l)
            if (m) message = m[1]
        }

        const exn: Error = {
            name: exnName,
            message,
            stack:
                `${exnName}: ${message}\n` +
                stack.filter(l => /^\s*at /.test(l)).join("\n"),
        }

        return {
            exn,
            logs,
        }
    }

    private async fastTick() {
        if (this.exnBuffer && this.lastExnBuffer === this.exnBuffer) {
            if (this.exnBuffer.length) {
                if (!this.exnLines) this.exnLines = []
                this.exnLines.push(this.exnBuffer.toString("utf-8"))
            }
            this.exnBuffer = null
            if (this.exnLines?.length) {
                const { exn, logs } = await this.parseException(this.exnLines)
                this.log.info(`exception: ${exn.stack}`)
                // TODO send logs somehow
                this.traceException(exn, {})
                await this.notify({
                    type: "exn",
                    exn,
                    logs,
                })
                this.exnLines = null
            }
        }
        this.lastExnBuffer = this.exnBuffer
        if ((this.tickNo++ & 7) == 0) await this.slowTick()
    }

    private async slowTick() {
        if (this.lastMsg || Object.values(this.stats).some(v => v != 0)) {
            const statsUpdate = this.stats
            const lastMsg = this.lastMsg

            this.lastMsg = 0
            this.stats = zeroDeviceStats()
            await updateDevice(this.id, d => {
                if (lastMsg) d.lastAct = lastMsg
                const stats = deviceStats(d)
                for (const k of Object.keys(statsUpdate)) {
                    stats[k] += statsUpdate[k]
                }
                d.statsJSON = JSON.stringify(stats)
                if (this.deployedHash)
                    d.deployedHash = this.deployedHash.toString("hex")
            })
        }
    }

    public trackEvent(name: string, options?: Partial<EventTelemetry>) {
        const { properties = {}, measurements = {}, ...rest } = options || {}
        const deviceProperties: any = {}
        if (this.deployedHash)
            deviceProperties.deployedHash = this.deployedHash.toString("hex")
        const deviceMeasurements: any = {}
        if (this.deployNumFail)
            deviceMeasurements.deployNumFail = this.deployNumFail
        this.track(
            <EventTelemetry>{
                ...rest,
                properties: {
                    ...properties,
                    ...deviceProperties,
                },
                measurements: {
                    ...measurements,
                    ...deviceMeasurements,
                },
                name: `device.${name}`,
            },
            TelemetryType.Event
        )
    }

    public trackMetric(name: string, options: Partial<MetricTelemetry>) {
        this.track(
            {
                name,
                kind: "Aggregation",
                ...options,
            },
            TelemetryType.Metric
        )
    }

    public traceTrace(
        messages: string[],
        options: Partial<TraceTelemetry> = {}
    ) {
        messages
            .map(logLineToTraceTelemetry)
            .filter(t => !!t)
            .forEach(telemetry => {
                this.track(
                    {
                        ...options,
                        ...telemetry,
                    } as TraceTelemetry,
                    TelemetryType.Trace
                )
            })
    }

    public traceException(
        exception: Error,
        options: Partial<ExceptionTelemetry>
    ) {
        console.log(`trace exception ${exception.name}(${exception.message})`)
        const { measurements = {}, ...rest } = options
        const deviceMeasurements: any = {}
        if (this.deployNumFail)
            deviceMeasurements.deployNumFail = this.deployNumFail

        this.track(
            {
                ...rest,
                measurements: {
                    ...measurements,
                    ...deviceMeasurements,
                },
                exception,
            } as ExceptionTelemetry,
            TelemetryType.Exception
        )
    }

    private trackWarning(message: string) {
        this.trackEvent("warning", { properties: { message } })
    }

    private track(telemetry: Telemetry, telemetryType: TelemetryType) {
        const dt = devsTelemetry()
        if (!dt) return

        const { tagOverrides = {}, ...rest } = telemetry
        const {
            productId,
            runtimeVersion,
            firmwareVersion,
            productName,
            company,
        } = tryParseJSON(this.dev.metaJSON)

        const devid = this.id.rowKey
        const deviceTagOverrides = {
            [contextTagKeys.sessionId]: this.sessionId,
            [contextTagKeys.userId]: devid,
            [contextTagKeys.userAuthUserId]: displayName(this.dev),
            [contextTagKeys.deviceType]: "Embedded",
            [contextTagKeys.deviceOEMName]: company,
            [contextTagKeys.deviceModel]:
                productName || productId?.toString(16),
            [contextTagKeys.deviceOSVersion]: runtimeVersion,
            [contextTagKeys.applicationVersion]: firmwareVersion,
            [contextTagKeys.locationIp]: this.meta.ip,
        }
        dt.track(
            {
                ...rest,
                tagOverrides: {
                    ...tagOverrides,
                    ...deviceTagOverrides,
                },
            },
            telemetryType
        )
    }
}

function aesBlock(key: Buffer, block: Buffer) {
    if (key.length != JD_AES_KEY_BYTES || block.length != JD_AES_BLOCK_BYTES)
        throw new Error("bad size")
    const cipher = crypto.createCipheriv("aes-256-ecb", key, "")
    const r0 = cipher.update(block)
    cipher.final()
    if (r0.length != block.length) throw new Error("r1 len")
    return r0
}

function incNonce(nonce: Buffer) {
    for (let i = JD_AES_CCM_NONCE_BYTES - 1; i >= 0; i--) {
        if (nonce[i] < 0xff) {
            nonce[i]++
            break
        } else {
            nonce[i] = 0x00
            continue
        }
    }
}

function aesCcmEncrypt(key: Buffer, nonce: Buffer, plaintext: Buffer) {
    if (
        key.length != JD_AES_KEY_BYTES ||
        nonce.length != JD_AES_CCM_NONCE_BYTES
    )
        throw new Error()

    const cipher = crypto.createCipheriv("aes-256-ccm", key, nonce, {
        authTagLength: JD_AES_CCM_TAG_BYTES,
    })
    const b0 = cipher.update(plaintext)
    const b1 = cipher.final()
    const tag = cipher.getAuthTag()
    return Buffer.concat([b0, b1, tag])
}

function aesCcmDecrypt(key: Buffer, nonce: Buffer, msg: Buffer) {
    if (
        key.length != JD_AES_KEY_BYTES ||
        nonce.length != JD_AES_CCM_NONCE_BYTES ||
        !Buffer.isBuffer(msg)
    )
        throw new Error()

    if (msg.length < JD_AES_CCM_TAG_BYTES) return null

    const decipher = crypto.createDecipheriv("aes-256-ccm", key, nonce, {
        authTagLength: JD_AES_CCM_TAG_BYTES,
    })

    decipher.setAuthTag(msg.slice(msg.length - JD_AES_CCM_TAG_BYTES))

    const b0 = decipher.update(msg.slice(0, msg.length - JD_AES_CCM_TAG_BYTES))
    try {
        decipher.final()
        return b0
    } catch {
        return null
    }
}

export function wsskConnString(dev: DeviceInfo) {
    const key = Buffer.from(dev.key, "base64").toString("hex")
    const host = selfHost()
    const devpath = fullDeviceId(dev)
    return `ws://wssk:${key}@${host}/wssk/${devpath}`
}

export function websockDataToBuffer(
    msg: Buffer | ArrayBuffer | Buffer[]
): Buffer {
    return Array.isArray(msg)
        ? Buffer.concat(msg)
        : Buffer.isBuffer(msg)
        ? msg
        : Buffer.from(msg)
}

export async function wsskInit(server: FastifyInstance) {
    server.get(
        "/wssk/:partId/:deviceId",
        { websocket: true },
        async (conn, req) => {
            let gotAuth = false
            let closed = false
            let log = req.log
            let cdev: ConnectedDevice

            let dev: DeviceInfo
            try {
                dev = await getDeviceFromFullPath(req)
            } catch (e: any) {
                return error(e.message)
            }

            cdev = new ConnectedDevice(
                dev,
                {
                    ip: req.ip,
                },
                (log = server.log.child({ wssk: dev.rowKey }))
            )

            const devkey = Buffer.from(dev.key, "base64")
            const server_random = crypto.randomBytes(JD_AES_KEY_BYTES / 2)
            let sessionKey: Buffer

            const m = /^(devs|jacdac)-key-([a-f0-9]+)$/i.exec(
                conn.socket.protocol
            )
            if (!m) return error("no proto-key")

            if (m[2].length != (JD_AES_KEY_BYTES / 2) * 2)
                return error("wrong proto-key size")
            const client_random = Buffer.from(m[2], "hex")

            let version = 1
            if (m[1] == "jacdac") {
                const chunk = JD_AES_KEY_BYTES / 4

                const key0 = aesBlock(
                    devkey,
                    Buffer.concat([
                        client_random.slice(0, chunk),
                        server_random.slice(0, chunk),
                    ])
                )
                const key1 = aesBlock(
                    devkey,
                    Buffer.concat([
                        client_random.slice(chunk, 2 * chunk),
                        server_random.slice(chunk, 2 * chunk),
                    ])
                )

                sessionKey = Buffer.concat([key0, key1])
            } else {
                version = 2
                sessionKey = Buffer.from(
                    crypto.hkdfSync(
                        "sha256",
                        devkey,
                        Buffer.alloc(0),
                        Buffer.concat([client_random, server_random]),
                        32
                    )
                )
            }

            const server_nonce = Buffer.alloc(JD_AES_CCM_NONCE_BYTES)
            const client_nonce = Buffer.alloc(JD_AES_CCM_NONCE_BYTES)

            client_nonce[0] = 1
            server_nonce[0] = 2

            const hello = Buffer.alloc(4 + 4 + server_random.length)
            hello.writeUInt32LE(JD_ENCSOCK_MAGIC, 0)
            hello.writeUInt32LE(version, 4)
            hello.set(server_random, 8)

            conn.socket.on("message", (msg, isBin) => {
                try {
                    if (closed) return
                    if (!isBin) return error("not binary")
                    const buf = websockDataToBuffer(msg)
                    const plain = aesCcmDecrypt(sessionKey, client_nonce, buf)
                    incNonce(client_nonce)
                    if (plain == null) return error("bad auth")
                    if (!gotAuth) {
                        if (plain.length < JD_AES_KEY_BYTES)
                            return error("too short auth")
                        if (
                            plain.slice(0, JD_AES_BLOCK_BYTES).some(x => x != 0)
                        )
                            return error("bad auth")
                        log.info(`auth OK`)
                        gotAuth = true
                        cdev.sendMsg = sendEnc
                        runInBg(log, "connected", cdev.connected())
                    } else {
                        runInBg(log, "fromDev", cdev.fromDevice(plain))
                    }
                } catch (e: any) {
                    log.error(`message handler: ${e.stack}`)
                    serverTelemetry()?.trackException({ exception: e })
                }
            })

            conn.socket.on("error", err => {
                log.warn(`websock error: ${err.message}`)
                if (!closed) {
                    closed = true
                    cdev.closed()
                    conn.socket.close() // just in case
                }
            })

            conn.socket.on("close", (code, reason) => {
                if (!closed) {
                    log.info(`socket closed ${code}`)
                    closed = true
                    cdev.closed()
                    conn.socket.close() // just in case
                }
            })

            conn.socket.send(hello)
            await sendEnc(Buffer.alloc(JD_AES_KEY_BYTES)) // send auth packet (lots of zeros)

            function error(msg: string) {
                log.warn(`closing socket: ${msg}`)
                if (!closed) {
                    closed = true
                    conn.socket.close(1000, msg)
                    cdev?.closed()
                }
            }

            function sendEnc(plain: Buffer) {
                const buf = aesCcmEncrypt(sessionKey, server_nonce, plain)
                incNonce(server_nonce)
                return new Promise<void>((resolve, reject) =>
                    conn.socket.send(buf, err => {
                        if (err) reject(err)
                        else resolve()
                    })
                )
            }
        }
    )
}
