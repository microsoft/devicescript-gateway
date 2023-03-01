#!/usr/bin/env zx

import "zx/globals"
import { randomBytes } from "crypto"
import { Octokit } from "@octokit/core"
import { readFileSync } from "fs"
import { create } from "xmlbuilder2"
import sodium from "libsodium-wrappers"

const GITHUB_API_VERSION = '2022-11-28'

echo(`DeviceScript Gateway configuration.`)
echo(``)
echo(`This script will create a new resource group, with a web app, application insights, key vault and storage account.`)
echo(`Make sure that you have the Azure CLI available and you are logged in.`)
echo(``)

const gatewayVersion = JSON.parse(readFileSync("./package.json", { encoding: "utf8" })).version
echo(chalk.blue(`gateway version: ${gatewayVersion}`))

const resourceGroup = await question(chalk.blue("Pick a name for the resource group: "))
if (!resourceGroup) throw "no resource group name given"

const namePrefix = await question(chalk.blue("Pick a name prefix for generated resources (unique, > 3 and < 13 characters): "))
if (!namePrefix) throw "no name prefix given"

const owner = process.env["GH_OWNER"] ?? await question(chalk.blue("Enter Github repository owner (env GH_OWNER): "))
const repo = owner ? process.env["GH_REPO"] ?? await question(chalk.blue("Enter Github repository repo name (env GH_REPO): ")) : undefined
const token = owner && repo ? process.env["GH_TOKEN"] ?? await question(chalk.blue("Enter Github token with repo scope (env GH_TOKEN, https://github.com/settings/personal-access-tokens/new with scopes actions, secrets): ")) : undefined

const octokit = token ? new Octokit({ auth: token }) : undefined
if (octokit) {
    echo(chalk.blue(`Checking Github repository...`))
    const res = await octokit.request('GET /repos/{owner}/{repo}', {
        owner,
        repo,
        headers: {
            'X-GitHub-Api-Version': GITHUB_API_VERSION
        }
    })
    if (res.status !== 200)
        throw new "invalid Github repository information"
}

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

// check keyvaults already exist
echo(chalk.blue(`Looking for deleting keyvaults that might name clash...`))
const deletevaults = JSON.parse((await $`az keyvault list-deleted`).stdout)
const deletedvault = deletevaults?.find(v => v.name === `${namePrefix.toLowerCase()}keys`)
if (deletedvault)
    throw `deleted keyvault ${deletedvault.name} already exists`

// fetch current user azure id
echo(chalk.blue(`Resolving Azure sign in user information...`))
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
const { outputs } = dinfo.properties
const webAppName = outputs.webAppName.value
const keyVaultName = outputs.keyVaultName.value

const homepage = `https://${webAppName}.azurewebsites.net/swagger/`

echo(chalk.blue(`Deployment: web app ${webAppName}, vault ${keyVaultName}`))

// generate local resource file
fs.writeFileSync(".env",
    `RESOURCE_GROUP="${resourceGroup}"
KEY_VAULT_NAME="${keyVaultName}"
SELF_URL="http://0.0.0.0:7071"`, { encoding: "utf8" })


if (octokit) {
    // download publish profile
    echo(chalk.blue('Download publish profile...'))
    const pb = JSON.parse((await $`resourceGroup="${resourceGroup}"
name="${webAppName}"
az webapp deployment list-publishing-profiles --name $name --resource-group $resourceGroup`).stdout)
    const zpd = pb?.find(o => o.publishMethod === "ZipDeploy")
    if (!zpd) throw "failed to fetch zip deploy publishing profile"

    const doc = create()
    const pd = doc.ele('publishData')
    const pp = pd.ele('publishProfile')
    pd.ele('databases')
    Object.keys(zpd).forEach(key => {
        pp.att(key, zpd[key])
    })
    const publishProfile = doc.end({ prettyPrint: true })
    const secret_name = "AZURE_WEBAPP_PUBLISH_PROFILE"

    echo(chalk.blue(`Creating GitHub repository secret with publishing profile...`))
    const respKey = (await octokit.request('GET /repos/{owner}/{repo}/actions/secrets/public-key', {
        owner,
        repo,
        headers: {
            'X-GitHub-Api-Version': GITHUB_API_VERSION
        }
    }))
    const key_id = respKey.data.key_id
    const key = respKey.data.key
    await sodium.ready
    const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    const binsec = sodium.from_string(publishProfile)
    const encBytes = sodium.crypto_box_seal(binsec, binkey)
    const encrypted_value = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)
    await octokit.request('PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}', {
        owner,
        repo,
        secret_name,
        encrypted_value,
        key_id,
        headers: {
            'X-GitHub-Api-Version': GITHUB_API_VERSION
        }
    })

    echo(chalk.blue("Trigger a Github Action `build.yml`..."))
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
        owner,
        repo,
        workflow_id: 'build.yml',
        ref: 'main',
        headers: {
            'X-GitHub-Api-Version': GITHUB_API_VERSION
        }
    })
} else {
    echo(chalk.red(`Publishing profile not configured in GitHub secrets!`))
}

// final notes
echo(chalk.blue(`Azure resources and local development configured successfully`))
echo(`-  navigate to ${homepage}`)
echo(`   and sign in as user: admin, password: ${adminPassword}`)
echo(`   (you can find the key in vault ${keyVaultName}/secrets/passwords.)`)