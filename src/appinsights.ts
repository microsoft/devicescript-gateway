import * as appInsights from "applicationinsights"

export async function setup() {
    appInsights.setup().start()
    const client = appInsights.defaultClient
    return client
}
