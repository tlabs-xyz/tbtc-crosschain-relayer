#!/bin/bash

# Script to update and redeploy the DigitalOcean App Platform application
# Supports deploying from local changes via DOCR or from GitHub (default).

# --- Configuration ---
APP_ID="a5c99193-7e58-43a5-a9d5-3f1d23a57648" # Your DigitalOcean App ID
DEFAULT_SPEC_FILE=".do/prod_spec.yaml"

# REQUIRED FOR LOCAL DEPLOYMENTS: Set your DigitalOcean Container Registry name (slug)
# Example: DOCR_REGISTRY_NAME="myregistry-slug"
DOCR_REGISTRY_NAME="tbtc-crosschain-relayer-dev"

# Image name to use in DOCR for local builds (repository name within your DOCR)
LOCAL_IMAGE_NAME="tbtc-crosschain-relayer-local" # You can change this

# --- Script Logic ---
DEPLOY_LOCAL=false
if [[ "$1" == "--local" ]]; then
  DEPLOY_LOCAL=true
fi

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

if [ "$DEPLOY_LOCAL" = true ]; then
  echo "Attempting to deploy local changes..."

  # Validations for local deployment
  if ! command_exists docker; then
    echo "Error: docker command not found. Please install Docker."
    exit 1
  fi
  if ! command_exists doctl; then
    echo "Error: doctl command not found. Please install doctl."
    exit 1
  fi
  if [ -z "$DOCR_REGISTRY_NAME" ]; then
    echo "Error: DOCR_REGISTRY_NAME is not set in the script."
    echo "Please edit this script and set your DigitalOcean Container Registry name."
    exit 1
  fi
  if [ -z "$LOCAL_IMAGE_NAME" ]; then
    echo "Error: LOCAL_IMAGE_NAME is not set in the script."
    exit 1
  fi

  # Check if logged into doctl registry. This is a basic check.
  # `doctl registry login` establishes this.
  if ! doctl registry get > /dev/null 2>&1; then
    echo "Error: Not logged into any DigitalOcean Container Registry via doctl, or cannot access it."
    echo "Please run 'doctl registry login' and ensure you have access to registry '${DOCR_REGISTRY_NAME}'."
    exit 1
  fi
  echo "Note: Ensure you have run 'doctl registry login' to allow Docker to push to registry.digitalocean.com/${DOCR_REGISTRY_NAME}"

  # Generate a unique tag for the local build (timestamp + short git hash)
  GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
  LOCAL_IMAGE_TAG=$(date +%Y%m%d%H%M%S)-${GIT_HASH}
  
  # Corrected image path structure: registry.digitalocean.com/<registry_slug>/<image_repo_name>:<tag>
  FULL_IMAGE_PATH_PREFIX="registry.digitalocean.com/${DOCR_REGISTRY_NAME}/${LOCAL_IMAGE_NAME}"
  FULL_LOCAL_IMAGE_FOR_BUILD="${FULL_IMAGE_PATH_PREFIX}:${LOCAL_IMAGE_TAG}"

  echo "Building local Docker image: $FULL_LOCAL_IMAGE_FOR_BUILD"
  if ! docker build -t "$FULL_LOCAL_IMAGE_FOR_BUILD" -f Dockerfile .; then
    echo "Error: Docker build failed."
    exit 1
  fi

  echo "Pushing image to DigitalOcean Container Registry: $FULL_LOCAL_IMAGE_FOR_BUILD"
  if ! docker push "$FULL_LOCAL_IMAGE_FOR_BUILD"; then
    echo "Error: Docker push failed. Make sure you are logged into your DOCR via 'doctl registry login' and that the registry path is correct."
    exit 1
  fi

  echo "Fetching image digest for repository ${LOCAL_IMAGE_NAME}, tag ${LOCAL_IMAGE_TAG} from registry ${DOCR_REGISTRY_NAME}"
  # doctl registry repository get-digest <repository_name_within_registry> --tag <tag_name>
  # This command operates in the context of the logged-in registry. 
  # If DOCR_REGISTRY_NAME is the specific registry slug, doctl should target it correctly if it was part of the login.
  IMAGE_DIGEST_SHA=$(doctl registry repository get-digest "${LOCAL_IMAGE_NAME}" --tag "${LOCAL_IMAGE_TAG}" --format Digest --no-header)

  if [ -z "$IMAGE_DIGEST_SHA" ]; then
      echo "Error: Could not retrieve image digest using 'doctl registry repository get-digest'."
      echo "Command was: doctl registry repository get-digest \"${LOCAL_IMAGE_NAME}\" --tag \"${LOCAL_IMAGE_TAG}\" --format Digest --no-header"
      echo "Ensure the image was pushed successfully to repository '${LOCAL_IMAGE_NAME}' within registry '${DOCR_REGISTRY_NAME}' and the tag exists."
      exit 1
  fi
  
  # Corrected full image name with digest for deployment
  FULL_IMAGE_NAME_WITH_DIGEST="${FULL_IMAGE_PATH_PREFIX}@${IMAGE_DIGEST_SHA}"

  echo "Deploying local build with image: $FULL_IMAGE_NAME_WITH_DIGEST to App ID: $APP_ID"
  if ! doctl apps create-deployment "$APP_ID" --image "$FULL_IMAGE_NAME_WITH_DIGEST" --wait; then
    echo "Error: 'doctl apps create-deployment' failed."
    exit 1
  fi
  echo "Local deployment command finished successfully."

else
  echo "Updating DigitalOcean App: $APP_ID with spec: $DEFAULT_SPEC_FILE from GitHub (main branch)"
  if ! doctl apps update "$APP_ID" --spec "$DEFAULT_SPEC_FILE" --update-sources --wait; then
    echo "Error: 'doctl apps update' failed."
    exit 1
  fi
  echo "GitHub deployment command finished successfully."
fi

echo "Deployment process completed." 