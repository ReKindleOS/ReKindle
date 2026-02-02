# Deploy to Cloudflare Beta

## Description
Deploys the current workspace to Cloudflare Pages as a preview version on the 'beta' branch.

## Usage
Use this skill when the user asks to "deploy to beta," "update the preview," or "ship to cloudflare beta."

## Execution
1. Ask the user for the Cloudflare Pages project name if it is not already known or set in the environment variables.
2. Run the script `deploy.sh` passing the project name as the first argument.
3. Output the final preview URL provided by the script output.