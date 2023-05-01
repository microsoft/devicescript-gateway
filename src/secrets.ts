import { createKeyVaultClient } from "./azure/keyvault"

export interface Secrets {
    getSecret(name: string): Promise<{ value?: string }>
}

export function createSecretClient(): Secrets {
    // try azure key vault
    const keyvault = createKeyVaultClient()
    if (keyvault) return keyvault

    // default to process.env
    return {
        async getSecret(name) {
            const value = process.env[name]
            return { value }
        },
    }
}

export async function getSecret(
    defaultName: string,
    secretNameEnvironmentName: string,
    environmentName?: string
) {
    const secrets = createSecretClient()
    const connectionStringSecretName =
        process.env[secretNameEnvironmentName] || defaultName
    const connStrSecret = await secrets.getSecret(connectionStringSecretName)
    const connStr =
        connStrSecret.value ||
        (environmentName ? process.env[environmentName] : undefined)
    return connStr
}
