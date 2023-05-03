import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"
import { Secrets } from "../secrets"

export function createKeyVaultClient(): Secrets {
    const { DEVS_KEY_VAULT_NAME } = process.env
    if (!DEVS_KEY_VAULT_NAME) return undefined
    const credential = new DefaultAzureCredential()
    const url = "https://" + DEVS_KEY_VAULT_NAME + ".vault.azure.net"
    const client = new SecretClient(url, credential)
    return client
}
