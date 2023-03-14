#!/bin/sh

set -x
set -e
(cd swagger-gen && node ../../node_modules/typescript/bin/tsc)
node swagger-gen/dist/writespec.js

# npm install -g @apidevtools/swagger-cli
swagger-cli validate apiDefinition.swagger.json

paconn validate -s settings.json
