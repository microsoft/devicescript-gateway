import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"
import dotenv from "dotenv"

export interface Secrets {
    getSecret(name: string): Promise<{ value?: string }>
}

export function createSecretClient(): Secrets {
    const keyVaultName = process.env["DEVS_KEY_VAULT_NAME"]
    if (!keyVaultName) {
        console.log(
            `no key DEVS_KEY_VAULT_NAME, using environment secrets or .env`
        )
        dotenv.config()
        return {
            async getSecret(name) {
                const value = process.env[name]
                return { value }
            },
        }
    }
    const credential = new DefaultAzureCredential()
    const url = "https://" + keyVaultName + ".vault.azure.net"
    const client = new SecretClient(url, credential)
    return client
}
