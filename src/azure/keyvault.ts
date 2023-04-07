import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"
import { Secrets } from "../secrets"

export function createKeyVaultClient(): Secrets {
    const keyVaultName = process.env["DEVS_KEY_VAULT_NAME"]
    if (!keyVaultName) {
        console.log(
            `no env DEVS_KEY_VAULT_NAME, using environment secrets and/or .env`
        )
        return undefined
    }
    const credential = new DefaultAzureCredential()
    const url = "https://" + keyVaultName + ".vault.azure.net"
    const client = new SecretClient(url, credential)
    return client
}
