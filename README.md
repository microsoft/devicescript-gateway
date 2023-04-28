# DeviceScript Development Gateway

This project contains a prototype development gateway implementation
for the built-in DeviceScript cloud integration.

The gateway can be run locally (no cloud dependencies), in GitHub CodeSpaces or deployed to Azure.

-   [Read the documentation](https://microsoft.github.io/devicescript/developer/gateway)

| :exclamation: This implementation is for prototyping only and not meant for production. |
| --------------------------------------------------------------------------------------- |

## Local development

- setup Node.JS 18

```bash
nvm install 18
nvm use 18
```

- download submodules and install dependencies

```bash
yarn setup
```

-   start a local instance using azurite

```bash
yarn dev
```

The terminal output will provide the connection string to connect 
to to the gateway from the DeviceScript Visual Studio Code extension.

-   **in GitHub Codespaces**, change the visibility of port `7071` to `Public`

You can also access the Swagger sandbox locally:

-   after running head to http://127.0.0.1:7071/swagger/ or otherwise the live site
-   Click Authorize
-   Use user/password `devstoreaccount1:Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==`

### CodeSandbox.io

Running the gateway in Codesandbox.io will give you an addressable web server that will be reachable by devices which the codespace
is active. It is an easy to get a development gateway available on the web without having to deal with network issues.
The tools will automatically detect Codesandbox.io and self configure.

- To open this repo in Codesandbox.io, https://codesandbox.io/p/github/microsoft/devicescript-gateway/main

## Azure services

Make sure to follow the provisioning steps in the documentation before trying to run locally.

-   start a local instance using Azure services

```
yarn dev:azure
```

-   after running head to http://127.0.0.1:7071/swagger/ or otherwise the live site
-   Click Authorize
-   Use user/password from the `passwords` secret in the key vault

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
