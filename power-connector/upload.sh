#!/bin/sh

set -x
set -e
./validate.sh
paconn update -s settings.json
