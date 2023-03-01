import {
    odata,
    TableClient,
    TableEntity,
    TableEntityResult,
    TransactionAction,
} from "@azure/data-tables"
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob"
import { randomBytes } from "crypto"
import { promisify } from "util"
import { gunzip, gzip } from "zlib"
import { pubToDevice } from "./devutil"
import { DeviceId, DeviceInfo, DeviceStats, zeroDeviceStats } from "./schema"
import { delay, throwStatus } from "./util"
import { createSecretClient } from "./vault"

const suff = "4"

let devicesTable: TableClient
let messageHooksTable: TableClient
let scriptsTable: TableClient
let scriptVersionsTable: TableClient
let blobClient: BlobServiceClient
let scriptsBlobs: ContainerClient
let telemetryTable: TableClient

export const defaultPartition = "main"

/**
 * Something like https://foobar.azurewebsites.net or http://localhost:1234
 */
export function selfUrl() {
    // use https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings?tabs=kudu%2Cdotnet
    const name = process.env["WEBSITE_SITE_NAME"]
    console.log({
        siteName: process.env["WEBSITE_SITE_NAME"],
        sku: process.env["WEBSITE_SKU"],
    })
    if (name) `https://${name}.azurewebsites.net`
    const url = process.env["SELF_URL"]?.replace(/\/$/, "")
    if (url) return url

    throw new Error("site name not configured")
}

export function selfHost() {
    return selfUrl()
        .replace(/^\w+:\/\//, "")
        .replace(/\/.*/, "")
}

export async function setup() {
    const secrets = createSecretClient()
    const connectionStringSecretName =
        process.env["STORAGE_CONNECTION_STRING_SECRET"] ||
        "storageAccountConnectionString"
    const connStrSecret = await secrets.getSecret(connectionStringSecretName)
    const connStr = connStrSecret.value
    if (!connStr) throw new Error("storage connection string is empty")

    devicesTable = TableClient.fromConnectionString(connStr, "devices" + suff)
    messageHooksTable = TableClient.fromConnectionString(
        connStr,
        "messagehooks" + suff
    )
    scriptsTable = TableClient.fromConnectionString(connStr, "scripts" + suff)
    scriptVersionsTable = TableClient.fromConnectionString(
        connStr,
        "scrver" + suff
    )

    blobClient = BlobServiceClient.fromConnectionString(connStr)
    scriptsBlobs = blobClient.getContainerClient("scripts" + suff)

    telemetryTable = TableClient.fromConnectionString(
        connStr,
        "telemetry" + suff
    )

    await devicesTable.createTable()
    await messageHooksTable.createTable()
    await scriptsTable.createTable()
    await scriptVersionsTable.createTable()
    await telemetryTable.createTable()

    await scriptsBlobs.createIfNotExists()

    if (false) {
        await scriptsBlobs.createIfNotExists({ access: "blob" })
        await blobClient.setProperties({
            cors: [
                {
                    allowedOrigins: "*",
                    allowedMethods: "GET,HEAD,OPTIONS",
                    allowedHeaders: "*",
                    exposedHeaders:
                        "ErrorMessage,x-ms-request-id,Server,x-ms-version,Content-Type,Cache-Control,Last-Modified,ETag,Content-MD5,x-ms-lease-status,x-ms-blob-type",
                    maxAgeInSeconds: 3600,
                },
            ],
        })
    }
}

function listByPartKey<T>(client: TableClient, partKey: string) {
    return client.listEntities({
        queryOptions: { filter: odata`PartitionKey eq ${partKey}` },
    })
}

async function queryByPartKey<T>(
    client: TableClient,
    partKey: string
): Promise<TableEntityResult<T>[]> {
    const res: any[] = []
    for await (const entry of listByPartKey(client, partKey)) {
        res.push(entry)
    }
    return res
}

function indexByRowKey<T>(lst: TableEntityResult<T>[]) {
    const r: Record<string, TableEntityResult<T>> = {}
    for (const e of lst) r[e.rowKey] = e
    return r
}

export async function getDeviceList(part: string) {
    return await queryByPartKey<DeviceInfo>(devicesTable, part)
}

export async function getDevice(id: DeviceId): Promise<DeviceInfo> {
    try {
        return await devicesTable.getEntity(id.partitionKey, id.rowKey)
    } catch (e) {
        return null
    }
}

export function deviceStats(d: DeviceInfo): DeviceStats {
    return Object.assign(zeroDeviceStats(), JSON.parse(d.statsJSON || "{}"))
}

export async function createDevice(
    id: DeviceId,
    opts: { name?: string; key: string }
) {
    await devicesTable.createEntity({
        partitionKey: id.partitionKey,
        rowKey: id.rowKey,
        ...opts,
    })
    return await getDevice(id)
}

export async function updateDevice(id: DeviceId, f: (d: DeviceInfo) => void) {
    const r = await updateEntity<DeviceInfo>(
        devicesTable,
        id.partitionKey,
        id.rowKey,
        f
    )
    await pubToDevice(id, { type: "update", dev: r })
    return r
}

export async function deleteDevice(id: DeviceId) {
    await devicesTable.deleteEntity(id.partitionKey, id.rowKey)
}

export function timeKey(t?: number) {
    if (!t) t = Date.now()
    return (1e10 - Math.round(t / 1000)).toString()
}

export function dateFromTimeKey(t: string) {
    return new Date((1e10 - parseInt(t.slice(0, 10))) * 1000)
}

export function randomKey(len = 20) {
    for (;;) {
        let r = randomBytes(len + 10)
            .toString("base64")
            .replace(/[^A-Za-z]/g, "")
        r = r.slice(0, len)
        if (r.length == len) return r
    }
}

export function uniqueKey() {
    return timeKey() + randomKey(12)
}

interface HookInfo {
    lookupKey: string
    url: string
    deviceId: string
    method: string
}

function mkHookKey(part: string, deviceId: string, method: string) {
    return part + "." + deviceId + "." + method
}

export async function addMessageHook(
    part: string,
    opts: {
        deviceId: string
        method: string
        url: string
    }
) {
    const deviceId = opts.deviceId || "_"
    const method = opts.method || "_"

    const partKey = mkHookKey(part, deviceId, method)
    const hookId = uniqueKey()

    const data: TableEntity<HookInfo> = {
        partitionKey: partKey,
        rowKey: hookId,
        lookupKey: partKey,
        url: opts.url,
        deviceId,
        method,
    }

    await messageHooksTable.createEntity<HookInfo>(data)
    data.partitionKey = part
    await messageHooksTable.createEntity<HookInfo>(data)

    return hookId
}

export async function deleteMessageHook(part: string, id: string) {
    const ent = await messageHooksTable.getEntity<HookInfo>(part, id)
    await messageHooksTable.deleteEntity(ent.lookupKey, ent.rowKey)
    await messageHooksTable.deleteEntity(part, ent.rowKey)
}

const getHooks = (partKey: string) =>
    queryByPartKey<HookInfo>(messageHooksTable, partKey)

export async function listMessageHooks(part: string) {
    return (await getHooks(part)).map(v => ({
        id: v.rowKey,
        url: v.url,
        deviceId: v.deviceId,
        method: v.method,
    }))
}

export async function getHooksFor(
    part: string,
    deviceId: string,
    method: string
) {
    const a = getHooks(mkHookKey(part, deviceId, method))
    const b = getHooks(mkHookKey(part, "_", method))
    const c = getHooks(mkHookKey(part, deviceId, "_"))
    const d = getHooks(mkHookKey(part, "_", "_"))
    return (await a)
        .concat(await b)
        .concat(await c)
        .concat(await d)
        .map(h => h.url)
}

interface ScriptInfo {
    partitionKey: string
    rowKey: string
    version: number
    name: string
    metaJSON: string
    updated: number
}

export interface ScriptHeader {
    id: string
    partition: string
    name: string
    version: number
    updated: number
    meta: {}
}

export interface FullScript extends ScriptHeader {
    body: {}
}

function toUserScript(
    v: ScriptInfo,
    parent?: number | ScriptHeader
): ScriptHeader {
    if (typeof parent == "number") return toUserScript(v)
    if (v.rowKey.length < 11 && !parent) throw new Error()
    const ts = (v as any).timestamp
    const updated = v.updated || (ts ? new Date(ts).getTime() : 0)
    return {
        id: parent?.id || v.rowKey,
        partition: parent?.partition || v.partitionKey,
        name: v.name,
        version: v.version,
        meta: JSON.parse(v.metaJSON || "{}"),
        updated,
    }
}

export function stringifyMeta(meta: {}) {
    if (!meta) return "{}"
    const r = JSON.stringify(meta)
    const maxMeta = 4000
    if (r.length > maxMeta)
        throwStatus(413, `meta too big ${r.length} chars (limit ${maxMeta})`)
    return r
}

export async function listScripts(part: string) {
    const headers = (await queryByPartKey<ScriptInfo>(scriptsTable, part)).map(
        toUserScript
    )
    return { headers }
}

export async function getScript(
    part: string,
    scriptId: string,
    verId?: number
) {
    const primary = toUserScript(await scriptsTable.getEntity(part, scriptId))
    if (!verId) return primary
    return toUserScript(
        await scriptVersionsTable.getEntity(scriptId, versionKey(verId)),
        primary
    )
}

function versionKey(version: number) {
    if (!version) throw new Error("bad version")
    return 1e6 - version + ""
}

async function createScriptSnapshot(scriptId: string, ver: number, body: {}) {
    const headId = versionKey(ver)
    const blobId = scriptId + "/" + headId

    if (!body || typeof body != "object" || Array.isArray(body))
        throwStatus(400, "bad body")

    const gz = promisify(gzip)
    const buf = Buffer.from(JSON.stringify(body), "utf-8")
    if (buf.length > 1024 * 1024) throwStatus(413, "script too big")
    const payload = await gz(buf)

    await scriptsBlobs.uploadBlockBlob(blobId, payload, payload.length, {
        blobHTTPHeaders: {
            blobCacheControl: "private, max-age=2592000",
            blobContentType: "application/json",
            blobContentEncoding: "gzip",
        },
    })
}

export interface ScriptProperties {
    name?: string
    meta?: {}
    body?: {}
}

export async function createScript(part: string, props: ScriptProperties) {
    const scriptId = uniqueKey()
    return await updateScript(
        {
            id: scriptId,
            partition: part,
            version: 0,
            name: "no name",
            meta: {},
            updated: 0,
        },
        props
    )
}

async function updateEntity<T extends {}>(
    client: TableClient,
    partKey: string,
    rowKey: string,
    update: (v: TableEntityResult<T>) => void
) {
    let cnt = 0
    for (;;) {
        const d = await client.getEntity<T>(partKey, rowKey)
        const pre = JSON.stringify(d)
        update(d)
        const post = JSON.stringify(d)
        if (pre == post) return d
        try {
            await client.updateEntity(d as any, "Replace", { etag: d.etag })
            return d
        } catch (e) {
            await delay(Math.random() * 50 + 10)
            if (cnt++ > 5) throw e
        }
    }
}

export async function updateScript(
    scr: ScriptHeader,
    updates: ScriptProperties
) {
    const newVersion = scr.version + 1
    const info: ScriptInfo = {
        partitionKey: scr.partition,
        rowKey: scr.id,
        version: newVersion,
        name: updates.name || scr.name,
        metaJSON: stringifyMeta(updates.meta || scr.meta),
        updated: Date.now(),
    }
    const versionEntry: ScriptInfo = {
        ...info,
        partitionKey: info.rowKey,
        rowKey: versionKey(info.version),
    }

    try {
        await scriptVersionsTable.createEntity(versionEntry)
    } catch (e) {
        console.log(e)
        throwStatus(429, "race condition updating script")
    }

    const body = updates.body || (await getScriptBody(scr.id, scr.version))
    await createScriptSnapshot(scr.id, newVersion, body)

    if (newVersion == 1) await scriptsTable.createEntity(info)
    else await scriptsTable.updateEntity(info, "Merge")

    return toUserScript(info)
}

export async function deleteScript(part: string, scriptId: string) {
    for await (const blob of scriptsBlobs.listBlobsFlat({
        prefix: scriptId + "/",
    })) {
        await scriptsBlobs.deleteBlob(blob.name)
    }
    for await (const entry of listByPartKey(scriptVersionsTable, scriptId)) {
        await scriptVersionsTable.deleteEntity(entry.partitionKey, entry.rowKey)
    }

    scriptVersionsTable.listEntities()
    await scriptsTable.deleteEntity(part, scriptId)
    return {}
}

async function downloadJsonBlob(client: ContainerClient, id: string) {
    const buf = await client.getBlobClient(id).downloadToBuffer()
    const ungz = promisify(gunzip)
    return JSON.parse((await ungz(buf)).toString("utf-8"))
}

export async function getScriptBody(scriptId: string, ver: number) {
    const id = scriptId + "/" + versionKey(ver)
    return await downloadJsonBlob(scriptsBlobs, id)
}

export async function getScriptVersions(scr: ScriptHeader) {
    return (await queryByPartKey<ScriptInfo>(scriptVersionsTable, scr.id)).map(
        d => toUserScript(d, scr)
    )
}

export interface TelemetrySource {
    brainId: string // "161f314155de245b"
    sensorId: string // "260f3e4155de245b"
    srv: string // "temperature"
    srvIdx: number // typically 0
}

export interface Telemetry extends TelemetrySource {
    ms: number // milliseconds since epoch aka Date.now()
    avg: number // 22.2 C, etc
    min?: number
    max?: number
    nsampl?: number // number of samples
    dur?: number // sampling time is from [ms-dur, ms]
}

export type TelemetryQuery = Partial<TelemetrySource> & {
    start?: number
    stop?: number
    first?: number
}

function sensorId(t: TelemetrySource) {
    let r = t.sensorId
    if (t.srv) r += ".S" + t.srv
    if (t.srvIdx != undefined) r += "." + t.srvIdx
    return r
}

function keysOfTelemetry(t: Telemetry) {
    checkTelemetrySource(t)
    const suff = sensorId(t)
    const ms = "T" + t.ms
    const srvSuff = t.brainId + "." + t.sensorId + "." + t.srvIdx
    return [
        ms + "." + t.brainId + "." + suff, // all data in time range
        t.brainId + "." + ms + "." + suff, // all data from given brain in time range
        t.brainId + "." + suff + "." + ms, // all data from given sensor in time range
        "S" + t.srv + "." + ms + "." + srvSuff, // data from given service in time range
    ]
}

function sanitizeTime(t: number, defl: number) {
    if (typeof t != "number" || isNaN(t)) t = defl
    // -12000 means 12s before now
    if (t < 0) t = Date.now() + t
    if (t < 1000000000000) t = 1000000000000
    if (t > 9990000000000) t = 9990000000000
    t = Math.round(t)
    return t
}

function checkDevId(d: string) {
    if (typeof d != "string" || !/^[0-9a-f]{16}$/.test(d))
        throwStatus(400, "invalid device ID")
}

function checkSrv(srv: string) {
    if (typeof srv != "string" || !/^[a-z]\w{1,100}$/.test(srv))
        throwStatus(400, "invalid srv")
}

function checkTelemetrySource(
    query: Partial<TelemetrySource>,
    optional = false
) {
    if (!optional || query.brainId) checkDevId(query.brainId)
    if (!optional || query.sensorId) checkDevId(query.sensorId)
    if (!optional || query.srv) checkSrv(query.srv)
    if (!optional || query.srvIdx != undefined) {
        if (
            typeof query.srvIdx != "number" ||
            query.srvIdx >>> 0 !== query.srvIdx ||
            query.srvIdx > 60
        )
            throwStatus(400, "invalid srvIdx")
    }
}

export async function queryTelemetry(part: string, query: TelemetryQuery) {
    const res: TableEntityResult<Telemetry>[] = []

    checkTelemetrySource(query, true)

    let pref = ""
    let full = false
    if (query.brainId) {
        pref = query.brainId + "."
        if (query.sensorId) {
            pref += sensorId(query as TelemetrySource) + "."
            if (query.srv && query.srvIdx != undefined) full = true
        }
    } else if (query.srv) {
        pref = "S" + query.srv + "."
    }

    const startKey =
        pref + "T" + sanitizeTime(query.start, 0) + (full ? "" : ".")
    const stopKey =
        pref + "T" + sanitizeTime(query.stop, Infinity) + (full ? "" : "~")

    const q = telemetryTable.listEntities<Telemetry>({
        queryOptions: {
            filter: odata`PartitionKey eq ${part} and RowKey ge ${startKey} and RowKey le ${stopKey}`,
        },
    })

    const first = Math.min(5000, query.first ?? 5000)
    for await (const entry of q) {
        res.push(entry)
        if (res.length >= first) break
    }

    return res
}

export async function insertTelemetry(part: string, entries: Telemetry[]) {
    let acc: TransactionAction[] = []
    for (const e of entries) {
        const actions = keysOfTelemetry(e).map(
            k =>
                [
                    "create",
                    {
                        ...e,
                        partitionKey: part,
                        rowKey: k,
                    },
                ] as TransactionAction
        )
        if (acc.length + actions.length > 99) {
            await telemetryTable.submitTransaction(acc)
            acc = []
        }
        acc.push(...actions)
    }
    if (acc.length) await telemetryTable.submitTransaction(acc)
}
