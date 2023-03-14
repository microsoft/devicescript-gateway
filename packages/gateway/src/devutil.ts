import * as mq from "./mq"
import { DeviceId, FromDeviceMessage, ToDeviceMessage } from "./schema"

export function fullDeviceId(id: DeviceId) {
    return id.partitionKey + "/" + id.rowKey
}

export function untilFromDevice(
    id: DeviceId,
    timeoutMS: number,
    cb: (msg: FromDeviceMessage) => boolean
) {
    return mq.until("from-dev/" + fullDeviceId(id), timeoutMS, cb)
}

export async function isDeviceConnected(
    id: DeviceId,
    timeoutMS: number = 5 * 1000
) {
    await pubToDevice(id, {
        type: "ping",
    })

    const res = await untilFromDevice(
        id,
        timeoutMS,
        msg => msg.type == "pong"
    ).then(
        r => r,
        _ => null
    )
    return res != null
}

export function subToDevice(
    id: DeviceId,
    cb: (msg: ToDeviceMessage) => Promise<void>
) {
    return mq.sub("to-dev/" + fullDeviceId(id), m => cb(m as any))
}

export function subFromDevice(
    id: DeviceId,
    cb: (msg: FromDeviceMessage) => Promise<void>
) {
    return mq.sub("from-dev/" + fullDeviceId(id), m => cb(m as any))
}

export function pubToDevice(id: DeviceId, msg: ToDeviceMessage) {
    msg.deviceId = id.rowKey
    msg.partitionId = id.partitionKey
    return mq.pub("to-dev/" + fullDeviceId(id), msg)
}

export function pubFromDevice(id: DeviceId, msg: FromDeviceMessage) {
    msg.deviceId = id.rowKey
    msg.partitionId = id.partitionKey
    return mq.pub("from-dev/" + fullDeviceId(id), msg)
}
