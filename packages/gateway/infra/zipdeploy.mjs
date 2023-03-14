import "zx/globals"
import dotenv from "dotenv"
import archiver from "archiver"

const out = dotenv.config({ path: ".env" })
if (out.error) throw out.error

const folder = "pkgtmp"
const zipPath = "pkg.zip"

await fs.ensureDir(folder)
await fs.copy("package.json", folder + "/package.json")
await fs.copy("dist", folder + "/dist")

await within(async () => {
    cd(folder)
    const _ = await $`yarn install --prod`
})

echo("Zipping...")

const zip = archiver("zip")
const output = fs.createWriteStream(zipPath)
zip.pipe(output)
zip.directory(folder, ".")
await zip.finalize()

const site = process.env.WEBSITE_SITE_NAME
const res = await $`az webapp deployment source config-zip \
  --resource-group ${process.env.WEBSITE_RESOURCE_GROUP} \
  --name ${site} \
  --src ${zipPath}`

// await fs.rm(zipPath)

echo(`start fetch https://${site}.azurewebsites.net so the website wakes up`)
const ignore = fetch(`https://${site}.azurewebsites.net`)

echo(`see https://${site}.scm.azurewebsites.net/ for logs!`)
echo(``)
