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

const pkg = JSON.parse(readFileSync("../package.json", { encoding: "utf8" }))
const gatewayVersion = pkg.version
echo(chalk.blue(`gateway version: ${gatewayVersion}`))

const resourceGroup = process.env["DEVS_RESOURCE_GROUP"] || await question(chalk.blue("Pick a name for the new resource group (env DEVS_RESOURCE_GROUP): "))
if (!resourceGroup) throw "no resource group name given"

let resourceLocation = process.env["DEVS_LOCATION"]
if (!resourceLocation) {
    echo(chalk.blue("Searching for available Azure locations..."))
    const locations = JSON.parse(
        (await $`az account list-locations`.quiet()).stdout
    ).filter(l => !l.name.includes("stage"))
    locations.sort((a, b) =>
        a.regionalDisplayName < b.regionalDisplayName ? -1 : 1
    )
    for (const loc of locations)
        echo(`${loc.name.padEnd(20)}  ${loc.regionalDisplayName}`)
    resourceLocation = await question(chalk.blue("Pick a region location for the resource group (env DEVS_LOCATION): "), { 
        choices: locations.map(l => l.name) 
    })
}
if (!resourceLocation)
    throw "no location provided"

const namePrefix = process.env["DEVS_NAME_PREFIX"] || await question(chalk.blue("Pick a name prefix for generated resources (unique, > 3 and < 13 characters, env DEVS_NAME_PREFIX): "))
if (!namePrefix) throw "no name prefix given"

const slug = process.env["GITHUB_REPOSITORY"] || await question(chalk.blue("Enter Github repository owner/repo (env GITHUB_REPOSITORY): "))
const [owner, repo] = slug?.split("/")
// codespace token cannot create/access secrets
const token = owner && repo ? process.env["DEVS_GITHUB_TOKEN"] || await question(chalk.blue("Enter Github token (env DEVS_GITHUB_TOKEN, https://github.com/settings/personal-access-tokens/new with read+write scopes actions, secrets): ")) : undefined
const octokit = owner && token && token ? new Octokit({ auth: token }) : undefined
if (octokit) {
    echo(chalk.blue(`Checking Github repository ${owner}/${repo}...`))
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
    const config = process.env["DEVS_DELETE_EXISTING_RESOURCE_GROUP"] || await question(chalk.red("Resource group already exists, delete? (yes/no, env DEVS_DELETE_EXISTING_RESOURCE_GROUP): "), { choices: ["yes", "no"] })
    if (config !== "yes") throw "resource group already exists"

    echo(chalk.blue(`Deleting resource group ${resourceGroup}...`))
    await $`az group delete --yes --name ${resourceGroup}`
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

const rsinfo = JSON.parse((await $`az group create --name ${resourceGroup} --location ${resourceLocation}`).stdout)

echo(chalk.blue(`Resource group: ${rsinfo.name}, ${rsinfo.id}`))

// create resources
const deploymentName = "devicescript"
const templateFile = "azuredeploy.json"
const dinfo = JSON.parse((await $`az deployment group create \
  --name ${deploymentName} \
  --resource-group ${resourceGroup} \
  --template-file ${templateFile} \
  --parameters ${parameterFile}`).stdout)
const { outputs } = dinfo.properties
const webAppName = outputs.webAppName.value
const keyVaultName = outputs.keyVaultName.value
const eventHubNamespaceName = outputs.eventHubNamespaceName.value
const storageConnectionStringSecretName = outputs.storageConnectionStringSecretName.value
const eventHubConnectionStringSecretName = outputs.eventHubConnectionStringSecretName.value
const passwordsSecretName = outputs.passwordsSecretName.value
const appInsightsConnectionString = outputs.appInsightsConnectionString.value

const homepage = `https://${webAppName}.azurewebsites.net/swagger/`

echo(chalk.blue(`Deployment: web app ${webAppName}, vault ${keyVaultName}`))

// generate local resource file
// use https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings?tabs=kudu%2Cdotnet
fs.writeFileSync("../.env",
    `APPLICATIONINSIGHTS_CONNECTION_STRING="${appInsightsConnectionString}"
WEBSITE_RESOURCE_GROUP="${resourceGroup}"
WEBSITE_SITE_NAME="${webAppName}"
WEBSITE_HOSTNAME=0.0.0.0:7071
DEVS_KEY_VAULT_NAME="${keyVaultName}"
DEVS_EVENT_HUB_NAME="${eventHubNamespaceName}"
DEVS_STORAGE_CONNECTION_STRING_SECRET="${storageConnectionStringSecretName}"
DEVS_EVENT_HUB_CONNECTION_STRING_SECRET="${eventHubConnectionStringSecretName}"
DEVS_PASSWORDS_SECRET="${passwordsSecretName}"
DEVS_SWAGGER_URL="${homepage}"
`, { encoding: "utf8" })

if (octokit) {
    // download publish profile
    echo(chalk.blue('Download publish profile...'))
    const pb = JSON.parse((await $`az webapp deployment list-publishing-profiles --name ${webAppName} --resource-group ${resourceGroup}`).stdout)
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

// download generate admin connection string
const connString = JSON.parse((await $`az keyvault secret show --vault-name ${keyVaultName} --name adminConnectionString`).stdout).value

// final notes
echo(chalk.blue(`Azure resources and local development configured successfully`))
echo(`-  take a break, the web site is building and deploying and it takes a few minutes`)
echo(`-  navigate to ${homepage} and sign in as`)
echo(`     user: admin`)
echo(`     password: ${adminPassword}`)
echo(`-  in Visual Studio Code, connect using`)
echo(`     ${connString}`)
echo(``)
echo(`Run 'yarn connection' to recover the connection string. You can find the keys in vault ${keyVaultName}/secrets.`)
echo(`Run 'yarn launch' to open the current swagger url.`)