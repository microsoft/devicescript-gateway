import { Telemetry } from "./storage"

function readU32(s: Buffer, off: number) {
    return s.readUInt32LE(off)
}
function readFloat(s: Buffer, off: number) {
    return s.readFloatLE(off)
}
function u8toString(a: Buffer) {
    return a.toString("utf-8")
}

const masks: Record<string, number> = {
    timedelta: 0x100,
    avg: 0x00,
    min: 0x01,
    max: 0x02,
    numsamples: 0x104,
    duration: 0x108,
}

export interface JdbrReadingSeries {
    timedelta: number[]
    avg: number[]
    min?: number[]
    max?: number[]
    numsamples?: number[]
    duration?: number[]
}
export interface ParsedJdbrMessage {
    deviceTime: number // ms
    readings: Record<string, Record<string, JdbrReadingSeries>>
}

export function parseJdbrMessage(buf: Buffer): ParsedJdbrMessage {
    if (buf.slice(0, 4).toString("ascii") != "JDBR")
        throw new Error("invalid message")

    let off = 12 + 28
    const res: ParsedJdbrMessage = {
        deviceTime: readU32(buf, 4) + 0x100000000 * readU32(buf, 8),
        readings: {},
    }
    while (off < buf.length) {
        let strp = off
        while (buf[off]) off++
        const id = u8toString(buf.slice(strp, off))
        off++
        let len = readU32(buf, off)
        const msk = len >>> 24
        len &= 0xffff
        off += 4
        const endp = off + len
        const ent: JdbrReadingSeries & Record<string, number[]> = {
            avg: [],
            timedelta: [],
        }
        while (off < endp) {
            for (const k of Object.keys(masks)) {
                const m = masks[k]
                if ((msk & m) != (0xff & m)) continue
                const v = m & 0x100 ? readU32(buf, off) : readFloat(buf, off)
                off += 4
                if (!ent[k]) ent[k] = []
                ent[k].push(v)
                if (off >= endp) break
            }
        }
        const [dev, serv] = id.split(":")
        if (!res.readings[dev]) res.readings[dev] = {}
        ent.timedelta = ent.timedelta.map(v => {
            // only allow deltas up to 1 month
            if (v > 30 * 24 * 3600 * 1000) throw new Error("too old entry")
            return -v
        })
        res.readings[dev][serv] = ent
    }
    return res
}

export function toTelemetry(
    brainId: string,
    msg: ParsedJdbrMessage,
    recvTime = Date.now()
): Telemetry[] {
    const r: Telemetry[] = []
    recvTime = Math.round(recvTime)
    for (const sensorId of Object.keys(msg.readings)) {
        const b = msg.readings[sensorId]
        for (let srv of Object.keys(b)) {
            const series = b[srv]
            let srvIdx = 0
            srv = srv.replace(/^_(\d+)$/, (_, n) => {
                srvIdx = parseInt(n) - 1
                return ""
            })
            for (let i = 0; i < series.timedelta.length; ++i) {
                r.push({
                    brainId,
                    sensorId,
                    srv,
                    srvIdx,
                    ms: recvTime + series.timedelta[i],
                    avg: series.avg[i],
                    min: series.min?.[i],
                    max: series.max?.[i],
                    nsampl: series.numsamples?.[i],
                    dur: series.duration?.[i],
                })
            }
        }
    }
    return r
}
