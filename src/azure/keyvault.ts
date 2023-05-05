import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"
import { Secrets } from "../secrets"

/**
 * KeyVault name
 */
export const DEVS_KEY_VAULT_NAME = "DEVS_KEY_VAULT_NAME"

export function createKeyVaultClient(): Secrets {
    const vaultName = process.env[DEVS_KEY_VAULT_NAME]
    if (!vaultName) return undefined
    const credential = new DefaultAzureCredential()
    const url = "https://" + vaultName + ".vault.azure.net"
    const client = new SecretClient(url, credential)
    return client
}
