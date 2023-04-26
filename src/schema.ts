import type { TableEntityResult } from "@azure/data-tables"

export interface MessageBase {
    type: string
}

export interface DeviceMessage extends MessageBase {
    partitionId?: string
    deviceId?: string
}

export interface SendJsonToDevice extends DeviceMessage {
    type: "sendJson"
    devTopic: string
    value: any
}

export interface SendBinToDevice extends DeviceMessage {
    type: "sendBin"
    devTopic: string
    payload64: string
}

export interface FrameToDevice extends DeviceMessage {
    type: "frameTo"
    payload64: string
}

export interface DeployToDevice extends DeviceMessage {
    type: "deploy"
    scriptId: string
}

export interface UploadJsonFromDevice extends DeviceMessage {
    type: "uploadJson"
    topic: string
    value: any
}

export interface UploadBinFromDevice extends DeviceMessage {
    type: "uploadBin"
    topic: string
    payload64: string
}

export interface WarningFromDevice extends DeviceMessage {
    type: "warning"
    message: string
}

export interface PingToDevice extends DeviceMessage {
    type: "ping"
    payload64?: string
}

export interface PongFromDevice extends DeviceMessage {
    type: "pong"
    payload64: string
}

export interface SetForwardingToDevice extends DeviceMessage {
    type: "setfwd"
    exceptions?: boolean
    logging?: boolean
    forwarding?: boolean
}

export type DeviceStats = Record<string, number> & {
    c2d: number
    c2dResp: number
    d2c: number
    conns: number
}

export interface DeviceUpdateToDevice extends DeviceMessage {
    type: "update"
    dev: DeviceInfo
}

export interface FrameFromDevice extends DeviceMessage {
    type: "frame"
    payload64: string
}

export interface ExnFromDevice extends DeviceMessage {
    type: "exn"
    exn: Error
    logs: string[]
}

export interface LogsFromDevice extends DeviceMessage {
    type: "logs"
    logs: string[]
}

export interface EnvironmentFromDevice extends DeviceMessage {
    type: "env"
    fields?: string[]
}

export type ToDeviceMessage =
    | SendBinToDevice
    | SendJsonToDevice
    | DeployToDevice
    | FrameToDevice
    | SetForwardingToDevice
    | PingToDevice
    | DeviceUpdateToDevice

export type FromDeviceMessage =
    | UploadJsonFromDevice
    | FrameFromDevice
    | UploadBinFromDevice
    | PongFromDevice
    | WarningFromDevice
    | ExnFromDevice
    | LogsFromDevice
    | EnvironmentFromDevice

export function zeroDeviceStats(): DeviceStats {
    return {
        c2d: 0,
        d2c: 0,
        c2dResp: 0,
        conns: 0,
    }
}

export interface DeviceId {
    partitionKey: string
    rowKey: string
}

export type DeviceInfo = TableEntityResult<{
    name: string
    key: string
    lastAct: number
    metaJSON?: string
    envJSON?: string
    statsJSON?: string
    scriptId?: string
    scriptVersion?: number
    deployedHash?: string
}> &
    DeviceId
