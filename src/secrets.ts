import dotenv from "dotenv"
import { createKeyVaultClient } from "./azure/keyvault"

export interface Secrets {
    getSecret(name: string): Promise<{ value?: string }>
}

export function createSecretClient(): Secrets {
    const keyvault = createKeyVaultClient()
    if (keyvault) return keyvault

    dotenv.config()
    return {
        async getSecret(name) {
            const value = process.env[name]
            return { value }
        },
    }
}
