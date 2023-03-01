# DeviceScript Development Gateway

This project contains a prototype development gateway implementation
for the built-in DeviceScript cloud integration.

| :exclamation: This implementation is for prototyping only and not meant for production. |
| --------------------------------------------------------------------------------------- |

## TODOs

-   [ ] program deployment
-   [ ] figure out why methods don't work
-   [ ]

## Setup

The ARM template creates a Web App (F1 by default), Server farm, Application Insights, a Key Vault and a Storage.
Once the ARM template has run, your DeviceScript development gateway will be ready to use.

-   create a parameter file `azuredeploy.parameters.json` (it's .gitignored)

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "namePrefix": {
            "value": ""
        },
        "adminUserId": {
            "value": ""
        },
        "adminPassword": {
            "value": ""
        }
    }
}
```

-   choose a name prefix and update it
-   open an Azure command prompt with the Azure Cli, login

```bash
az login --output yaml
```

-   find your user `id` and update `adminUserId` value

```bash
az ad signed-in-user show --output yaml
```

```console
...
id: ....
...
```

-   create a new password and udpate `adminPassword`

```bash
openssl rand -base64 32
```

-   create new resource group and run template and enter user id, admin password

```bash
resourceGroup="DeviceScript"
templateFile="azuredeploy.json"
parametersFile="azuredeploy.parameters.json"
az group create --name $resourceGroup --location centralus --output yaml
az deployment group create \
  --name devicescript \
  --resource-group $resourceGroup \
  --template-file $templateFile \
  --parameters $parametersFile \
  --output yaml
```

-   open the Azure portal and open the new web app
-   download the publish profile and store it as a secret in the github secrets section under `AZURE_WEBAPP_PUBLISH_PROFILE`

-   trigger a build and the web app will deploy automatically
-   do a post to `/api/setup` to configure the storage accounts

## Clean up resources

To delete the entire resource group, and start clean.

```bash
resourceGroup="DeviceScript"
az group delete --name $resourceGroup --output yaml
```

Key vaults might have a soft-delete policy and you'll need to change the prefix or purge them.

## Local development

-   create a new `.env` file (it is git ignored) and include the key vault name and the local url, for local testing.

```txt
KEY_VAULT_NAME="create key vault name"
SELF_URL="http://0.0.0.0:7071"
```

-   start a local instance using

```
yarn dev
```

-   after running head to http://127.0.0.1:7071/swagger/ or otherwise the live site
-   Click Authorize
-   Use user/password from the `passwords` secret in the key vault

## Deployment

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
