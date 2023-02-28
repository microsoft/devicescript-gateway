import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"

export function createSecretClient() {
    const keyVaultName = process.env["KEY_VAULT_NAME"]
    if (!keyVaultName) throw new Error("KEY_VAULT_NAME is empty")
    const credential = new DefaultAzureCredential()
    const url = "https://" + keyVaultName + ".vault.azure.net"
    const client = new SecretClient(url, credential)
    return client
}
