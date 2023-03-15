import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"

export function createSecretClient() {
    const keyVaultName = process.env["DEVS_KEY_VAULT_NAME"]
    if (!keyVaultName) throw new Error("DEVS_KEY_VAULT_NAME is empty")
    const credential = new DefaultAzureCredential()
    const url = "https://" + keyVaultName + ".vault.azure.net"
    const client = new SecretClient(url, credential)
    return client
}
