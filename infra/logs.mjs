import "zx/globals"
import dotenv from "dotenv"

const out = dotenv.config({ path: ".env" })
if (out.error) throw out.error

const res = await $`az webapp log tail \
  --resource-group ${process.env.WEBSITE_RESOURCE_GROUP} \
  --name ${process.env.WEBSITE_SITE_NAME}`
