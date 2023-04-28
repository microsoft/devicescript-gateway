import { FastifyBaseLogger } from "fastify"
import { DeviceInfo } from "./schema"

/**
 * Something like https://foobar.azurewebsites.net or http://localhost:1234
 */
export function selfUrl() {
    // use https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings?tabs=kudu%2Cdotnet
    const hostname = process.env["WEBSITE_HOSTNAME"]
    if (!hostname) throw new Error("WEBSITE_HOSTNAME not configured")
    const protocol = /^(127\.|0\.|localhost)/i.test(hostname) ? "http" : "https"
    return `${protocol}://${hostname}`
}

export function selfHost() {
    return selfUrl()
        .replace(/^\w+:\/\//, "")
        .replace(/\/.*/, "")
}

export function webSiteName() {
    const siteName = process.env["WEBSITE_SITE_NAME"]
    return siteName || "localhost"
}

export function idiv(a: number, b: number) {
    return ((a | 0) / (b | 0)) | 0
}
export function fnv1(data: Uint8Array) {
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; ++i) {
        h = Math.imul(h, 0x1000193) ^ data[i]
    }
    return h
}

export function hash(buf: Uint8Array, bits: number) {
    bits |= 0
    if (bits < 1) return 0
    const h = fnv1(buf)
    if (bits >= 32) return h >>> 0
    else return ((h ^ (h >>> bits)) & ((1 << bits) - 1)) >>> 0
}

export function shortDeviceId(devid: Uint8Array) {
    const h = hash(devid, 30)
    return (
        String.fromCharCode(0x41 + (h % 26)) +
        String.fromCharCode(0x41 + (idiv(h, 26) % 26)) +
        String.fromCharCode(0x30 + (idiv(h, 26 * 26) % 10)) +
        String.fromCharCode(0x30 + (idiv(h, 26 * 26 * 10) % 10))
    )
}

export function checkString(s: any, maxLen = 100) {
    if (typeof s != "string") throwStatus(400, "string expected")
    if (s.length > maxLen)
        throwStatus(413, `string too long; max len=${maxLen}`)
}

export function throwStatus(code: number, msg = ""): never {
    let info = "HTTP " + code
    if (msg) info += ": " + msg
    const e = new Error(info)
        ; (e as any).statusCode = code
    throw e
}

export function sanitizeDeviceId(name: string) {
    if (!name) return null
    name = name.replace(/^[A-Z][A-Z]\d\d_/, "").replace(/\s+/g, "")
    if (/^[a-f0-9]{16}$/.test(name)) {
        return name.toLowerCase()
    }
    return null
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function runInBg(log: FastifyBaseLogger, lbl: string, p: Promise<any>) {
    // log.debug(`bg ${lbl}`)
    p.then(
        _ => { },
        err => {
            log.error(`error in ${lbl}: ${err.message} ${err.stack}`, { err })
        }
    )
}

export function displayName(info: DeviceInfo) {
    const devid = info.rowKey
    return `${info.name || devid} (${shortDeviceId(Buffer.from(devid, "hex"))})`
}

export function tryParseJSON(json: string, missing = "{}") {
    try {
        return JSON.parse(json || missing)
    } catch {
        return JSON.parse(missing)
    }
}
