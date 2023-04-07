import dotenv from "dotenv"
import { createKeyVaultClient } from "./azure/keyvault"

export interface Secrets {
    getSecret(name: string): Promise<{ value?: string }>
}

export function createSecretClient(): Secrets {
    // try azure key vault
    const keyvault = createKeyVaultClient()
    if (keyvault) return keyvault

    // default to process.env
    dotenv.config()
    return {
        async getSecret(name) {
            const value = process.env[name]
            return { value }
        },
    }
}
