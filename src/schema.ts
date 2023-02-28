import type { TableEntityResult } from "@azure/data-tables"

export interface MessageBase {
    type: string
}

export interface DeviceMessage extends MessageBase {
    partitionId?: string
    deviceId?: string
}

export interface MethodCallToDevice extends DeviceMessage {
    type: "method"
    methodName: string
    rid: number
    payload: any
}

export interface FrameToDevice extends DeviceMessage {
    type: "frameTo"
    payload64: string
}

export interface DeployToDevice extends DeviceMessage {
    type: "deploy"
    scriptId: string
}

export interface JacsUploadFromDevice extends DeviceMessage {
    type: "jacsUpload"
    label: string
    values: number[]
}

export interface UploadBinFromDevice extends DeviceMessage {
    type: "uploadBin"
    payload64: string
}

export interface WarningFromDevice extends DeviceMessage {
    type: "warning"
    message: string
}

export interface MethodResultFromDevice extends DeviceMessage {
    type: "methodRes"
    rid: number
    statusCode: number
    payload: any
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
    forwarding: boolean
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

export type ToDeviceMessage =
    | MethodCallToDevice
    | DeployToDevice
    | FrameToDevice
    | SetForwardingToDevice
    | PingToDevice
    | DeviceUpdateToDevice

export type FromDeviceMessage =
    | JacsUploadFromDevice
    | MethodResultFromDevice
    | FrameFromDevice
    | UploadBinFromDevice
    | PongFromDevice
    | WarningFromDevice

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
    statsJSON?: string
    scriptId?: string
    scriptVersion?: number
    deployedHash?: string
}> & DeviceId
