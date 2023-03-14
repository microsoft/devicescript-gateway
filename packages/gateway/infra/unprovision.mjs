import dotenv from "dotenv"
const out = dotenv.config({ path: "../.env"})
if (out.error)
    throw out.error
const resourceGroup = process.env.WEBSITE_RESOURCE_GROUP || await question("Enter the resource group name to delete: ")
await $`az group delete --name ${resourceGroup}`
