import { selfUrl, webSiteName } from "../storage"
import {
    init,
    basicAuth,
    connectorMetadata,
    define,
    withDynamicValues,
    sString,
    sObj,
    sNumber,
    sBool,
    post,
    action,
    pBody,
    trigger,
    sWebHookURL,
    get,
    response,
    sArray,
    del,
    pPath,
    setVisibility,
    patch,
    put,
    allOptional,
    allNonOptional,
    example,
    finish,
    PlainSchema,
    pQuery,
} from "./gen"

export function generateOpenApiSpec() {
    const root = selfUrl()
    init(`${root}/api`, {
        title: webSiteName(),
        description: "Development DeviceScript Gateway",
        version: "1.0",
    })
    basicAuth()
    connectorMetadata({
        website: root,
        privacy: root,
        categories: "Internet of Things",
    })

    const devIdParam = withDynamicValues(
        sString("Device ID", "Something like ZX12_9ab02928adf3912aa"),
        {
            operationId: "Devices",
            id: "id",
            display: "displayName",
        }
    )

    const methodParam = sString("Method name", "Must match the value on device")

    const eventSchema = define(
        "EventSchema",
        sObj({
            deviceId: devIdParam,
            method: methodParam,
            payload: sNumber(
                "Method argument",
                "The number passed from device along with the method name"
            ),
        })
    )
    const scriptId = example(
        sString("Script ID", "Reverse timestamp plus random letters"),
        "8333876049kJJpBGuRmXEd"
    )
    const versionId = example(
        sNumber("Script Version", "Numeric version number"),
        42
    )
    const devProps: Record<string, PlainSchema> = {
        "name?": sString("User-assigned name of device"),
        "meta?": sObj({}),
        "scriptId?": scriptId,
        "scriptVersion?": versionId,
    }
    const deviceSchema = define(
        "Device",
        sObj({
            id: sString("Device ID", "Unique identifier of the device"),
            displayName: sString("User-friendly Name"),
            conn: sBool("Connected", "Is device currently connected"),
            lastAct: sString(
                "Last Connected",
                "When was device last connected"
            ),
            ...allNonOptional(devProps),
            deployedHash: sString(
                "SHA256 Hash of Currently Deployed Script",
                "This property persists when the device is disconnected, so may not be up to date"
            ),
        })
    )
    const serviceSchema = sString(
        "Service Name",
        "Type of sensor (eg. 'temperature')"
    )
    const sensorIdSchema = sString(
        "Sensor ID",
        "Unique identifier of the sensor"
    )
    const serviceIdxSchema = sNumber(
        "Service Index",
        "Typically 0; used when there is more than one instance of service in the sensor"
    )
    const telemetrySchema = define(
        "Telemetry",
        sObj({
            brainId: sString(
                "Brain ID",
                "Unique identifier of the network-connected device"
            ),
            sensorId: sensorIdSchema,
            srv: serviceSchema,
            srvIdx: serviceIdxSchema,
            ms: msTime("Timestamp"),
            avg: sNumber("Sensor Reading", "Average of samples"),
            "min?": sNumber("Minimum Reading", "Smallest of samples"),
            "max?": sNumber("Maximum Reading", "Largest of samples"),
            "nsampl?": sNumber(
                "Number of Samples",
                "How many samples were taken"
            ),
            "dur?": sNumber(
                "Sampling Duration",
                "Number of milliseconds in the sampling period ending at Timestamp"
            ),
        })
    )

    post(
        "/devices/{deviceId}/method",
        action("Call", "Call Method", "Invoke method on a remote device", [
            pPath("deviceId", devIdParam),
            pBody(
                sObj({
                    method: methodParam,
                    "args?": sArray(
                        sNumber(
                            "Argument to method",
                            "Argument will be available on the device side"
                        )
                    ),
                })
            ),
        ])
    )

    post(
        "/hooks",
        trigger(
            "Message",
            "When a device sends a message",
            "Runs when a message is sent from the device to the cloud",
            [
                pBody(
                    sObj({
                        "deviceId?": devIdParam,
                        "method?": methodParam,
                        url: sWebHookURL(),
                    })
                ),
            ],
            eventSchema
        )
    )

    get(
        "/devices",
        action(
            "Devices",
            "List devices",
            "Returns a list of available devices, connected or not",
            [],
            {
                "200": response("Available devices", sArray(deviceSchema)),
            }
        )
    )

    setVisibility("internal")

    del(
        "/hooks/{hookId}",
        action("DeleteTrigger", "Delete a webhook", "", [
            pPath("hookId", sString("Hook ID", "ID of the hook being deleted")),
        ])
    )

    del(
        "/devices/{deviceId}",
        action(
            "DeleteDevice",
            "Delete Device",
            "Remove device from Hub and delete its metadata",
            [pPath("deviceId", devIdParam)]
        )
    )

    post(
        "/devices/{deviceId}/json",
        action(
            "SendJSON",
            "Send JSON Message",
            "Send a JSON payload to device",
            [pPath("deviceId", devIdParam), pBody(sObj({}))]
        )
    )

    post(
        "/devices/{deviceId}/binary",
        action(
            "SendBinary",
            "Send Binary Message",
            "Send a binary payload to device",
            [
                pPath("deviceId", devIdParam),
                pBody(
                    sObj({
                        "hex?": sString("hex-encoded buffer"),
                        "base64?": sString("base64-encoded buffer"),
                    })
                ),
            ]
        )
    )

    post(
        "/devices",
        action(
            "CreateDevice",
            "Create device",
            "Can be also used to get the deployment key",
            [
                pBody(
                    sObj({
                        deviceId: sString("Device ID"),
                        ...devProps,
                    })
                ),
            ],
            {
                "200": response(
                    "Available devices",
                    sObj({
                        deviceId: sString("Device ID"),
                        connectionString: sString("IOT Hub Connection String"),
                    })
                ),
            }
        )
    )

    const deviceResponse = {
        "200": response("Device description", deviceSchema),
    }

    get(
        "/hooks",
        action("Hooks", "List active hooks", "", [], {
            "200": response(
                "Active hooks",
                sArray(
                    sObj({
                        id: sString("Hook ID"),
                        url: sString("User-side URL to be called"),
                        deviceId: sString("Device ID or _"),
                        method: sString("Method name or _"),
                    })
                )
            ),
        })
    )

    get(
        "/devices/{deviceId}",
        action(
            "GetDevice",
            "Get Device",
            "Get properties of a single device",
            [pPath("deviceId", devIdParam)],
            deviceResponse
        )
    )

    get(
        "/devices/{deviceId}/fwd",
        action(
            "DeviceFwdSocket",
            "Get Forwarding Socket for Device",
            "Get a connection for direct talk with the Jacdac bus connected to the device",
            [pPath("deviceId", devIdParam)],
            {
                "200": response(
                    "Connection info",
                    sObj({
                        url: sString("wss://... URL"),
                        protocol: sString(
                            "Pass as argument to new WebSocket()"
                        ),
                        expires: sNumber("JS timestamp"),
                    })
                ),
            }
        )
    )

    patch(
        "/devices/{deviceId}",
        action(
            "UpdateDevice",
            "Update properties of a device",
            "",
            [
                pPath("deviceId", devIdParam),
                pBody(
                    sObj({
                        ...devProps,
                    })
                ),
            ],
            deviceResponse
        )
    )

    function queryParams() {
        return [
            pQuery("start", msTime("Start Time")),
            pQuery("stop", msTime("Stop Time")),
            pQuery(
                "first",
                sNumber("Return First", "Max. number of elements to return")
            ),
        ]
    }

    const telemetryResponse = {
        "200": response("Telemetry entries", sArray(telemetrySchema)),
    }

    get(
        "/devices/telemetry",
        action(
            "Telemetry",
            "Get telemetry from all devices",
            "",
            queryParams(),
            telemetryResponse
        )
    )

    get(
        "/devices/telemetry/{service}",
        action(
            "ServiceTelemetry",
            "Get telemetry from all devices for a given service (sensor type)",
            "",
            [pPath("service", serviceSchema)].concat(queryParams()),
            telemetryResponse
        )
    )

    get(
        "/devices/{deviceId}/telemetry",
        action(
            "DeviceTelemetry",
            "Get telemetry from a given device",
            "",
            [pPath("deviceId", devIdParam)].concat(queryParams()),
            telemetryResponse
        )
    )

    get(
        "/devices/{deviceId}/telemetry/{sensorId}/{service}/{srvIdx}",
        action(
            "SensorTelemetry",
            "Get telemetry from a given sensor on a given device",
            "",
            [
                pPath("deviceId", devIdParam),
                pPath("sensorId", sensorIdSchema),
                pPath("service", serviceSchema),
                pPath("srvIdx", serviceIdxSchema),
            ].concat(queryParams()),
            telemetryResponse
        )
    )

    const scriptProps = {
        name: example(sString("package/path"), "my-device/main"),
        meta: sObj({}),
    }
    const scriptBody = define(
        "ScriptBody",
        sObj({
            program: sObj({}),
        })
    )
    const scriptPropsWithBody = {
        ...scriptProps,
        body: scriptBody,
    }

    function msTime(name: string) {
        return example(sNumber(name, "Milliseconds since epoch"), 1667258306330)
    }

    const scriptHeaderSchema = define(
        "Script",
        sObj({
            ...scriptProps,
            id: scriptId,
            partition: example(
                sString("User or environment where the script belongs"),
                "main"
            ),
            version: versionId,
            updated: msTime("Update time"),
        })
    )
    get(
        "/scripts",
        action("ListScripts", "List script headers", "", [], {
            "200": response(
                "Scripts in account",
                sObj({ headers: sArray(scriptHeaderSchema) })
            ),
        })
    )
    const scriptHeaderResponse = {
        "200": response("Script Header", scriptHeaderSchema),
    }
    const scriptParam = pPath("scriptId", scriptId)
    const versionParam = pPath("version", versionId)
    get(
        "/scripts/{scriptId}",
        action(
            "GetScripts",
            "Get one script header",
            "",
            [scriptParam],
            scriptHeaderResponse
        )
    )
    get(
        "/scripts/{scriptId}/body",
        action("GetScriptBody", "Get body of a script", "", [scriptParam], {
            "200": response("Script body", scriptBody),
        })
    )
    put(
        "/scripts/{scriptId}/body",
        action(
            "SetScriptBody",
            "Set body of a script",
            "",
            [scriptParam, pBody(scriptBody)],
            scriptHeaderResponse
        )
    )
    patch(
        "/scripts/{scriptId}",
        action(
            "UpdateScript",
            "Set script header properties or body",
            "",
            [scriptParam, pBody(sObj(allOptional(scriptPropsWithBody)))],
            scriptHeaderResponse
        )
    )
    del(
        "/scripts/{scriptId}",
        action("DeleteScript", "Remove script and all its bodies", "", [
            scriptParam,
        ])
    )
    post(
        "/scripts",
        action(
            "CreateScript",
            "Create a new script",
            "",
            [pBody(sObj(scriptPropsWithBody))],
            scriptHeaderResponse
        )
    )

    get(
        "/scripts/{scriptId}/versions",
        action(
            "GetScriptVersions",
            "Get headers of all versions of a script",
            "",
            [scriptParam],
            {
                "200": response(
                    "Versions of the script",
                    sArray(scriptHeaderSchema)
                ),
            }
        )
    )

    get(
        "/scripts/{scriptId}/versions/{version}",
        action(
            "GetScriptVersion",
            "Get header of one version of a script",
            "",
            [scriptParam, versionParam],
            {
                "200": response(
                    "Versions of the script",
                    sArray(scriptHeaderSchema)
                ),
            }
        )
    )

    get(
        "/scripts/{scriptId}/versions/{version}/body",
        action(
            "GetScriptVersionBody",
            "Get body of one version of a script",
            "",
            [scriptParam, versionParam],
            {
                "200": response("Body of version", scriptBody),
            }
        )
    )

    return finish()
}
