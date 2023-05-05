import mqemitter, { Message } from "mqemitter"

export const emitter = mqemitter({
    matchEmptyLevels: true,
})

let errorHandler = (topic: string, err: Error) => {
    console.error(`TOPIC: ${topic}, error:`, err)
}

export function setErrorHandler(cb: (topic: string, err: Error) => void) {
    errorHandler = cb
}

export async function sub(topic: string, f: (msg: Message) => Promise<void>) {
    return new Promise<() => void>((resolve, reject) => {
        function cb(msg: Message, done: () => void) {
            f(msg as any).then(
                _ => done(),
                err => {
                    errorHandler(topic, err)
                }
            )
        }
        emitter.on(topic, cb, () =>
            resolve(() => {
                emitter.removeListener(topic, cb)
            })
        )
    })
}

export async function pub(topic: string, payload: any) {
    const msg: Message = { topic, payload }
    return new Promise<void>((resolve, reject) => {
        emitter.emit(msg, err => (err ? reject(err) : resolve()))
    })
}

export async function until<T>(
    topic: string,
    timeoutMS: number,
    cond: (payload: T) => boolean
) {
    return new Promise<T>((resolve, reject) => {
        function finish() {
            resolve = null
            emitter.removeListener(topic, cb)
        }
        function cb(msg: Message, done: () => void) {
            const { topic, payload } = msg
            try {
                if (cond(payload) && resolve) {
                    const r = resolve
                    finish()
                    r(payload)
                }
            } catch (e) {
                if (resolve) {
                    finish()
                    reject(e)
                } else {
                    errorHandler(topic, e as any)
                }
            }
            done()
        }

        emitter.on(topic, cb)
        if (timeoutMS)
            setTimeout(() => {
                if (resolve) {
                    finish()
                    const r = new Error(
                        `timeout on topic ${topic} (${timeoutMS}ms)`
                    )
                    ;(r as any).statusCode = 408
                    reject(r)
                }
            }, timeoutMS)
    })
}
