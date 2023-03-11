import { FastifyInstance, FastifyRequest } from "fastify"
import * as storage from "./storage"
import { checkString, throwStatus } from "./util"

function checkScriptId(id: string) {
    if (typeof id != "string" || !/^\d{10}[a-zA-Z]{12}$/.test(id))
        throwStatus(400, "invalid scriptId")
}

export async function initScriptRoutes(server: FastifyInstance) {
    server.get("/scripts", async req => {
        return await storage.listScripts(req.partition)
    })

    async function getScript(req: FastifyRequest) {
        const scriptId = (req.params as any).scriptId
        checkScriptId(scriptId)
        const verId = parseInt((req.params as any).version) || undefined
        try {
            return await storage.getScript(req.partition, scriptId, verId)
        } catch (e: any) {
            if (e.statusCode == 404)
                throwStatus(
                    404,
                    `script not found: ${scriptId} (${verId || "latest"})`
                )
            else throw e
        }
    }

    server.get("/scripts/:scriptId", getScript)
    server.get("/scripts/:scriptId/body", async req => {
        const scr = await getScript(req)
        return await storage.getScriptBody(scr.id, scr.version)
    })

    server.put("/scripts/:scriptId/body", async req => {
        const scr = await getScript(req)
        const body = verifyBody(req.body)
        return await storage.updateScript(scr, { body })
    })

    server.get("/scripts/:scriptId/versions", async req => {
        const scr = await getScript(req)
        const headers = await storage.getScriptVersions(scr)
        return { headers }
    })

    server.get("/scripts/:scriptId/versions/:version", getScript)
    server.get("/scripts/:scriptId/versions/:version/body", async req => {
        const scr = await getScript(req)
        return await storage.getScriptBody(scr.id, scr.version)
    })

    function verifyBody(body: any): storage.ScriptBody {
        if (typeof body != "object" || Array.isArray(body))
            throwStatus(412, "invalid body type")
        if (JSON.stringify(body).length > 5 * 1024 * 1024)
            throwStatus(413, "body too large")
        const b = body as storage.ScriptBody
        if (!b.program || typeof b.program?.binary?.hex != "string")
            throwStatus(418, "invalid body format")
        return body
    }

    function getScriptData(req: FastifyRequest) {
        const reqbody: any = req.body
        const props: storage.ScriptProperties = {
            name: reqbody.name,
            meta: reqbody.meta,
            body: reqbody.body,
        }
        if (props.name != undefined) checkString(props.name, 128)
        if (props.meta != undefined) {
            if (typeof props.meta != "object" || Array.isArray(props.meta))
                throwStatus(400, "bad meta")
            if (JSON.stringify(props.meta).length > 1024)
                throwStatus(413, "meta too large")
        }
        if (props.body != undefined) verifyBody(props.body)
        return props
    }

    server.patch("/scripts/:scriptId", async req => {
        const scr = await getScript(req)
        const updates = getScriptData(req)
        return await storage.updateScript(scr, updates)
    })

    server.delete("/scripts/:scriptId", async req => {
        const scr = await getScript(req)
        return await storage.deleteScript(req.partition, scr.id)
    })

    server.post("/scripts", async req => {
        const props = getScriptData(req)
        if (!props.body) throwStatus(400, "no body")
        return await storage.createScript(req.partition, props)
    })
}
