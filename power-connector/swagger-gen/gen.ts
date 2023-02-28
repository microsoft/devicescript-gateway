import * as url from "url"
import { OpenAPIV2 } from "openapi-types"

let currVisibility: string
export let spec: OpenAPIV2.Document

export function init(apiUrl: string, info: typeof spec.info) {
    const u = url.parse(apiUrl)
    spec = {
        swagger: "2.0",
        info,
        consumes: ["application/json"],
        produces: ["application/json"],
        schemes: [u.protocol.replace(/:/, "")],
        host: u.hostname,
        basePath: u.path,
        paths: {},
        definitions: {},
        tags: [],
    }
    currVisibility = undefined
}

export type PowerVisiblity = "" | "important" | "advanced" | "internal"

export function setVisibility(v: PowerVisiblity) {
    currVisibility = v
}

export function basicAuth() {
    spec.securityDefinitions = {
        basic_auth: {
            type: "basic",
        },
    }
    spec.security = [
        {
            basic_auth: [],
        },
    ]
}

export function connectorMetadata(opts: {
    website: string
    privacy: string
    categories: string
}) {
    spec["x-ms-connector-metadata"] = [
        {
            propertyName: "Website",
            propertyValue: opts.website,
        },
        {
            propertyName: "Privacy policy",
            propertyValue: opts.privacy,
        },
        {
            propertyName: "Categories",
            propertyValue: opts.categories,
        },
    ]
}

function oops(msg: string) {
    throw new Error(msg)
}

export type OpObject = OpenAPIV2.OperationObject
export type ParamObject = OpenAPIV2.Parameter | OpenAPIV2.ReferenceObject
export type ResponsesObject = OpenAPIV2.ResponsesObject
export type Response = OpenAPIV2.Response
export type Ref = OpenAPIV2.ReferenceObject
export type PlainSchema = OpenAPIV2.SchemaObject & { __schema: null }
export type Schema = PlainSchema | Ref

export function route(
    method: OpenAPIV2.HttpMethods,
    path: string,
    obj: OpObject
) {
    if (!spec.paths[path]) spec.paths[path] = {}
    if (spec.paths[path][method]) oops(`redefinition of ${method} ${path}`)
    spec.paths[path][method] = obj
    if (obj["x-ms-notification-content"]) {
        const notificationContent = obj["x-ms-notification-content"]
        delete obj["x-ms-notification-content"]
        spec.paths[path]["x-ms-notification-content"] = notificationContent
    }
}

function strcmp(a: string, b: string) {
    return a < b ? -1 : a > b ? 1 : 0
}

function sortKeys(obj: Record<string, any>, compareFn = strcmp) {
    const obj2 = { ...obj }
    const keys = Object.keys(obj)
    for (const k of keys) delete obj[k]
    keys.sort(compareFn)
    for (const k of keys) {
        obj[k] = obj2[k]
    }
}

export function get(path: string, obj: OpObject) {
    route(OpenAPIV2.HttpMethods.GET, path, obj)
}
export function post(path: string, obj: OpObject) {
    route(OpenAPIV2.HttpMethods.POST, path, obj)
}
export function del(path: string, obj: OpObject) {
    route(OpenAPIV2.HttpMethods.DELETE, path, obj)
}
export function put(path: string, obj: OpObject) {
    route(OpenAPIV2.HttpMethods.PUT, path, obj)
}
export function patch(path: string, obj: OpObject) {
    route(OpenAPIV2.HttpMethods.PATCH, path, obj)
}

function validate(regexp: RegExp, str: string, lbl: string) {
    if (!regexp.test(str))
        console.warn(
            `string ${JSON.stringify(str)} (${lbl}) doesn't match ${regexp}`
        )
}

export function action(
    operationId: string,
    summary: string,
    description: string,
    parameters: ParamObject[],
    responses?: ResponsesObject
): OpObject {
    validate(/^[a-z0-9]+$/i, operationId, "operationId")
    validate(/^.{5,30}$/i, summary, "operationId")
    if (!description) description = summary
    if (!responses)
        responses = {
            default: {
                description: "default",
                schema: {},
            },
        }
    const r: OpObject = {
        operationId,
        summary,
        description,
        parameters,
        responses,
    }

    if (currVisibility) r["x-ms-visibility"] = currVisibility

    return r
}

export function trigger(
    operationId: string,
    summary: string,
    description: string,
    parameters: ParamObject[],
    eventSchema: Schema
): OpObject {
    const r = action(operationId, summary, description, parameters, {
        "201": {
            description: "Created",
            schema: {},
        },
    })

    r["x-ms-trigger"] = "single"

    r["x-ms-notification-content"] = {
        description: "Details for event",
        schema: eventSchema,
    }

    return r
}

export function pBody(schema: Schema): OpenAPIV2.InBodyParameterObject {
    return {
        name: "body",
        in: "body",
        required: true,
        schema,
    }
}

export function pPath(name: string, schema: Schema): ParamObject {
    const r = {
        name,
        in: "path",
        required: true,
        "x-ms-url-encoding": "single",
        ...schema,
    } as any
    delete r.example
    return r
}

export function pQuery(name: string, schema: Schema): ParamObject {
    const r = {
        name,
        in: "query",
        "x-ms-url-encoding": "single",
        ...schema,
    } as any
    delete r.example
    return r
}

export function sObj(props: { [name: string]: Schema }): PlainSchema {
    let required = Object.keys(props).filter(s => !s.endsWith("?"))
    if (required.length == 0) required = undefined
    const properties: Record<string, Schema> = {}
    for (const k of Object.keys(props)) {
        const obj = props[k]
        const k1 = k.replace(/\?$/, "")
        properties[k1] = obj
    }
    return {
        __schema: undefined,
        type: "object",
        properties,
        required,
    }
}

export function sArray(itemType: Schema): PlainSchema {
    return {
        __schema: undefined,
        type: "array",
        items: itemType as any,
    }
}

export function sLeaf(
    tp: string,
    title: string,
    description?: string
): PlainSchema {
    return {
        __schema: undefined,
        type: tp,
        "x-ms-summary": title,
        description,
    }
}

export function sString(title: string, description?: string) {
    return sLeaf("string", title, description)
}
export function sNumber(title: string, description?: string) {
    return sLeaf("number", title, description)
}
export function sBool(title: string, description?: string) {
    return sLeaf("boolean", title, description)
}

export function example<T extends { example?: any }>(v: T, ex: any): T {
    return { ...v, example: ex }
}

export function sWebHookURL() {
    const r = sString(
        "Webhook URL",
        "URL that gets called when the event occurs"
    )
    r["x-ms-notification-url"] = true
    r["x-ms-visibility"] = "internal"
    return r
}

export function response(description: string, schema: Schema): Response {
    return {
        description,
        schema,
    }
}

export function define(id: string, val: Schema): Ref {
    if (spec.definitions[id]) oops(`definition ${id} already there`)
    validate(/^\w+$/, id, "define id")
    spec.definitions[id] = val
    return { $ref: "#/definitions/" + id }
}

export function withDynamicValues(
    schema: Schema,
    opts: { operationId: string; id: string; display: string }
) {
    return {
        ...schema,
        "x-ms-dynamic-values": {
            operationId: opts.operationId,
            "value-path": opts.id,
            "value-title": opts.display,
        },
    }
}

export function allOptional<T>(v: Record<string, T>): Record<string, T> {
    const r: Record<string, T> = {}
    for (const k of Object.keys(v)) {
        const k2 = k.endsWith("?") ? k : k + "?"
        r[k2] = v[k]
    }
    return r
}

export function allNonOptional<T>(v: Record<string, T>): Record<string, T> {
    const r: Record<string, T> = {}
    for (const k of Object.keys(v)) {
        const k2 = k.replace("?", "")
        r[k2] = v[k]
    }
    return r
}

function dellast(s: string) {
    if (s == "delete") return "z" + s
    return s
}

export function finish() {
    sortKeys(spec.paths)
    for (const p of Object.values(spec.paths)) {
        sortKeys(p, (a, b) => strcmp(dellast(a), dellast(b)))
    }
    const r = spec
    spec = null
    return r
}
