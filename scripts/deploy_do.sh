#!/bin/bash

# Script to update and redeploy the DigitalOcean App Platform application

# TODO: Support staging environment

APP_ID="a5c99193-7e58-43a5-a9d5-3f1d23a57648"
SPEC_FILE="prod_spec.yaml"

echo "Updating DigitalOcean App: $APP_ID with spec: $SPEC_FILE"

doctl apps update $APP_ID --spec $SPEC_FILE --update-sources --wait

echo "Deployment command finished." 