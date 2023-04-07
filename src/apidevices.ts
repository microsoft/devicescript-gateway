import { randomBytes } from "crypto"
import { FastifyInstance, FastifyRequest } from "fastify"
import {
    checkString,
    displayName,
    sanitizeDeviceId,
    selfUrl,
    throwStatus,
    tryParseJSON,
} from "./util"
import { DeviceId, DeviceInfo, FromDeviceMessage } from "./schema"
import { wsskConnString } from "./wssk"
import { fullDeviceId, pingDevice, pubToDevice } from "./devutil"
import { fwdSockConnSettings } from "./fwdsock"
import {
    addMessageHook,
    createDevice,
    deleteDevice,
    deleteMessageHook,
    deviceStats,
    getDevice,
    getDeviceList,
    getScript,
    listMessageHooks,
    stringifyMeta,
    updateDevice,
} from "./storage"

const CONNECTED_TIMEOUT = 2 * 60 * 1000
export const MAX_WSSK_SIZE = 230 // for to-device JSON and binary messages

function externalDevice(info: DeviceInfo) {
    const conn = Date.now() - info.lastAct < CONNECTED_TIMEOUT
    return {
        partition: info.partitionKey,
        id: info.rowKey,
        displayName: displayName(info),
        name: info?.name ?? "",
        conn,
        scriptId: info.scriptId,
        scriptVersion: info.scriptVersion,
        deployedHash: info.deployedHash,
        lastAct: info.lastAct ? new Date(info.lastAct).toISOString() : "",
        meta: tryParseJSON(info.metaJSON),
        stats: deviceStats(info),
    }
}

async function singleDevice(id: DeviceId) {
    const dev = await getDevice(id)
    if (!dev) throwStatus(404, "no such device")
    return externalDevice(dev)
}

function validateMethod(method: string) {
    if (!method || !/^\w{1,100}$/.test(method))
        throwStatus(412, "invalid method")
}

export function getDeviceIdFromParams(req: FastifyRequest, part?: string) {
    return sanitizeDeviceIdOrThrow(req, (req.params as any).deviceId, part)
}

export async function getDeviceFromFullPath(req: FastifyRequest) {
    const part = (req.params as any)["partId"]
    if (!(typeof part == "string" && /^\w{2,32}$/.test(part)))
        throwStatus(400, "invalid partitionId: " + part)
    const devid = getDeviceIdFromParams(req, part)
    const dev = await getDevice(devid)
    if (dev == null) throwStatus(404, "no such device: " + devid.rowKey)
    return dev
}

function sanitizeDeviceIdOrThrow(
    req: FastifyRequest,
    name: string,
    part?: string
) {
    const n = sanitizeDeviceId(name)
    if (n == null) throwStatus(400, "invalid deviceId: " + name)
    return devId(part || req.partition, n)
}

async function addDevice(id: DeviceId) {
    let dev = await getDevice(id)
    if (!dev) {
        console.log(`creating device ${fullDeviceId(id)}`)
        dev = await createDevice(id, {
            key: randomBytes(32).toString("base64"),
        })
    }
    return dev
}

async function sendJSON(id: DeviceId, topic: string, json: any) {
    const buf = Buffer.from(JSON.stringify(json), "utf-8")
    if (buf.length > MAX_WSSK_SIZE)
        throwStatus(
            413,
            `JSON too big (${buf.length} bytes, max ${MAX_WSSK_SIZE})`
        )
    await pubToDevice(id, {
        type: "sendJson",
        topic,
        value: json,
    })
}

async function sendBinary(id: DeviceId, topic: string, buf: Buffer) {
    if (buf.length > MAX_WSSK_SIZE)
        throwStatus(
            413,
            `binary message too big (${buf.length} bytes, max ${MAX_WSSK_SIZE})`
        )
    await pubToDevice(id, {
        type: "sendBin",
        topic,
        payload64: buf.toString("base64"),
    })
}

function devId(part: string, devid: string): DeviceId {
    return {
        partitionKey: part,
        rowKey: devid,
    }
}

async function patchDevice(id: DeviceId, req: FastifyRequest) {
    let { name, meta, scriptId, scriptVersion } = req.body as any
    // null -> ""
    if (scriptId === null) scriptId = ""
    if (name != undefined) checkString(name)
    if (scriptVersion != undefined) {
        if (!scriptVersion || (scriptVersion | 0) != scriptVersion)
            throwStatus(400, "invalid scriptVersion")
        if (!scriptId) throwStatus(400, "scriptVersion needs scriptId")
    }
    if (scriptId != undefined && scriptId != "") {
        checkString(scriptId)
        try {
            const scr = await getScript(req.partition, scriptId, scriptVersion)
            // default to latest version
            if (!scriptVersion) scriptVersion = scr.version
        } catch (e: any) {
            if (e.statusCode == 404)
                throwStatus(
                    404,
                    `script not found: ${scriptId} (${
                        scriptVersion || "latest"
                    })`
                )
            else throw e
        }
    }

    await updateDevice(id, d => {
        if (name != undefined) d.name = name
        if (meta != undefined) d.metaJSON = stringifyMeta(meta)
        if (scriptId != undefined) {
            d.scriptId = scriptId
            d.scriptVersion = scriptVersion
        }
    })
    return await singleDevice(id)
}

export async function initHubRoutes(server: FastifyInstance) {
    server.post("/devices/:deviceId/ping", async req => {
        const devid = getDeviceIdFromParams(req)
        const duration = await pingDevice(devid)
        return {
            duration,
        }
    })

    server.post("/devices/:deviceId/json", async req => {
        const devid = getDeviceIdFromParams(req)
        const topic = (req.body as any)["$topic"]
        if (typeof topic != "string") throwStatus(400, "missing $topic")
        delete (req.body as any)["$topic"]
        await sendJSON(devid, topic, req.body)
        return {}
    })

    server.post("/devices/:deviceId/binary", async req => {
        const devid = getDeviceIdFromParams(req)
        const { base64, hex } = req.body as any
        if (!base64 && !hex)
            throwStatus(400, "either hex or base64 field required")
        const topic = (req.body as any)["$topic"]
        if (typeof topic != "string") throwStatus(400, "missing $topic")
        let buf: Buffer
        try {
            buf = hex ? Buffer.from(hex, "hex") : Buffer.from(base64, "base64")
        } catch {}
        if (!buf || !buf.length) throwStatus(400, "invalid buffer")
        await sendBinary(devid, topic, buf)
        return {}
    })

    server.post("/devices", async req => {
        const { deviceId } = req.body as any
        const devid = sanitizeDeviceIdOrThrow(req, deviceId)
        const dev = await addDevice(devid)
        const r = await patchDevice(devid, req)
        return { ...r, connectionString: wsskConnString(dev) }
    })

    server.post("/hooks", async (req, reply) => {
        let { deviceId, method, url } = req.body as any
        if (deviceId) deviceId = getDeviceIdFromParams(deviceId)
        if (method) validateMethod(method)
        if (typeof url != "string" || !/^https:\/\//.test(url))
            throwStatus(418, "invalid URL")
        const key = await addMessageHook(req.partition, {
            deviceId,
            method,
            url,
        })
        return reply
            .status(201)
            .headers({ location: selfUrl() + "/hooks/" + key })
            .send({ id: key })
    })

    server.get("/hooks", async req => {
        return await listMessageHooks(req.partition)
    })

    server.delete<{ Params: { hookId: string } }>(
        "/hooks/:hookId",
        async req => {
            await deleteMessageHook(req.partition, req.params.hookId)
            return {}
        }
    )

    server.get("/devices", async req => {
        const infos = await getDeviceList(req.partition)
        return infos.map(externalDevice)
    })

    server.get("/devices/:deviceId", async req => {
        const devid = getDeviceIdFromParams(req)
        return await singleDevice(devid)
    })

    server.get("/devices/:deviceId/fwd", async req => {
        const devid = getDeviceIdFromParams(req)
        const dev = await getDevice(devid)
        return fwdSockConnSettings(dev, "devfwd")
    })

    server.get("/devices/:deviceId/logs", async req => {
        const devid = getDeviceIdFromParams(req)
        const dev = await getDevice(devid)
        return fwdSockConnSettings(dev, "devlogs")
    })

    server.patch("/devices/:deviceId", async req => {
        const devid = getDeviceIdFromParams(req)
        return await patchDevice(devid, req)
    })

    server.delete("/devices/:deviceId", async req => {
        const devid = getDeviceIdFromParams(req)
        await deleteDevice(devid)
        return {}
    })
}
