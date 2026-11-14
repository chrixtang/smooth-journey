#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${2:-asia-east2}"
SERVICE_NAME="${3:-smooth-journey}"
MODEL_ID="${MODEL_ID:-gemini-2.5-flash}"

if [ -z "$PROJECT_ID" ]; then
  echo "Usage: ./deploy-gcp.sh <GCP_PROJECT_ID> [REGION=asia-east2] [SERVICE_NAME=smooth-journey]"
  exit 1
fi

echo "Running unit tests..."
npm test

echo "Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  --project "$PROJECT_ID"

echo "Deploying $SERVICE_NAME to Cloud Run ($REGION)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --concurrency 80 \
  --min-instances 1 \
  --max-instances 1 \
  --set-env-vars "MODEL_ID=$MODEL_ID,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1"

URL=$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
echo ""
echo "Deployed: $URL"
echo "Health check:"
curl -sS "$URL/api/health"
echo ""
