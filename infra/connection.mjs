import dotenv from "dotenv"
const out = dotenv.config({ path: "../.env" })
if (out.error)
    throw out.error
const keyVaultName = process.env.DEVS_KEY_VAULT_NAME
// download generate admin connection string
const connString = JSON.parse((await $`az keyvault secret show --vault-name ${keyVaultName} --name adminConnectionString`).stdout).value
echo(connString)