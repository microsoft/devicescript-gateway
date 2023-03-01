#!/usr/bin/env zx

import "zx/globals"
import { randomBytes } from "crypto"
import { request } from "@octokit/request"
import { readFileSync } from "fs"
import { create } from "xmlbuilder2"

echo(`DeviceScript Gateway configuration.`)
echo(``)
echo(`This script will create a new resource group, with a web app, application insights, key vault and storage account.`)
echo(`Make sure that you have the Azure CLI available and you are logged in.`)
echo(``)

const gatewayVersion = JSON.parse(readFileSync("./package.json", { encoding: "utf8" })).version
echo(chalk.blue(`gateway version: ${gatewayVersion}`))

const resourceGroup = await question(chalk.blue("Pick a name for the resource group: "))
if (!resourceGroup) throw "no resource group name given"

// check if resource group already exists
echo(`Searching for existing resource group ${resourceGroup}...`)
const exists = JSON.parse((await $`az group list --query "[?name=='${resourceGroup}']"`).stdout)
if (exists?.length) {
    const config = await question(chalk.red("Resource group already exists, delete? (yes/no) "), { choices: ["yes", "no"] })
    if (config !== "yes") throw "resource group already exists"

    echo(`deleting resource group ${resourceGroup}...`)
    await $`resourceGroup="${resourceGroup}"
az group delete --yes --name $resourceGroup`
}

const namePrefix = await question(chalk.blue("Pick a name prefix for generated resources (unique, > 3 and < 13 characters): "))
if (!namePrefix) throw "no name prefix given"

// check keyvaults already exist
echo(`Looking for deleting keyvaults that might name clash...`)
const deletevaults = JSON.parse((await $`az keyvault list-deleted`).stdout)
const deletedvault = deletevaults?.find(v => v.name === `${namePrefix.toLowerCase()}keys`)
if (deletedvault)
    throw `delete keyvault ${deletedvault.name} already exists`

// fetch current user azure id
echo(`Resolving Azure sign in user information...`)
const userInfo = JSON.parse((await $`az ad signed-in-user show`).stdout)
const adminUserId = userInfo.id
echo(chalk.blue(`Azure signin user: ${userInfo.displayName}, ${adminUserId}`))

// generate password
const adminPassword = randomBytes(64).toString('base64url')

// write parameter file
const parameterFile = `azuredeploy.parameters.json`
echo`write ${parameterFile}`
fs.writeFileSync(parameterFile, JSON.stringify({
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "gatewayVersion": {
            "value": gatewayVersion
        },
        "namePrefix": {
            "value": namePrefix
        },
        "adminUserId": {
            "value": adminUserId
        },
        "adminPassword": {
            "value": adminPassword
        }
    }
}, null, 4), { encoding: "utf8" })

const rsinfo = JSON.parse((await $`resourceGroup="${resourceGroup}"
az group create --name $resourceGroup --location centralus`).stdout)

echo(chalk.blue(`Resource group: ${rsinfo.name}, ${rsinfo.id}`))

// create resources
const dinfo = JSON.parse((await $`resourceGroup="${resourceGroup}"
templateFile="azuredeploy.json"
parametersFile="${parameterFile}"
az deployment group create \
  --name devicescript \
  --resource-group $resourceGroup \
  --template-file $templateFile \
  --parameters $parametersFile`).stdout)
const did = dinfo
const { outputs } = dinfo.properties
const { webAppName, keyVaultName } = outputs

echo(chalk.blue(`Deployment: web app ${webAppName}, vault ${keyVaultName}`))

// generate local resource file
fs.writeFileSync(".env",
    `RESOURCE_GROUP="${resourceGroup}"
KEY_VAULT_NAME="${keyVaultName}"
SELF_URL="http://0.0.0.0:7071"`, { encoding: "utf8" })

// download publish profile
const pb = JSON.parse((await $`resourceGroup="${resourceGroup}"
name="${webAppName}"
az webapp deployment list-publishing-profiles --name $name --resource-group $resourceGroup`).stdout)
const zpb = pb?.filter(o => o.publishMethod === "ZipDeploy")
if (!zpb) throw "failed to fetch zip deploy publishing profile"

echo('download publish profile...')
const doc = create()
const pp = doc.ele('publishData').ele('publishProfile')
Object.keys(zpd).forEach(key => pp.att(key, zpd[key]))
const pfn = `${webAppName}.PublishSettings`
const xzpb = doc.end({ prettyPrint: true })
echo(`publish profile: ${pfn}`)
fs.writeFileSync(pfn, xzpb, { encoding: "utf8" })

// final notes
echo(chalk.blue(`Azure resources and local development configured successfully`))
echo(`-  add GitHub secret AZURE_WEBAPP_PUBLISH_PROFILE with the content of ${pfn}`)
echo(`-  navigate to https://${webAppName}.azurewebsites.net/swagger/`)
echo(`   and sign in as user: admin, password: ${adminPassword}`)
echo(`   (you can find the key in vault ${keyVaultName}/secrets/passwords.)`)