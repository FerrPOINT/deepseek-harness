# DSH deployment for Fleet

Run one Compose project per Fleet DSH agent. Each has its own configuration,
provider credential file, workspace, data directory, HTTP token, and private
network. Fleet joins the agent networks that it operates. The agent services
do not need published host ports.

## Image

From the DSH checkout with its locked release build dependencies installed,
stage a new build context using the Node runtime pinned in the Dockerfile.
Pass the recorded source revision as the image build argument.

~~~bash
packages/sdk/server/fleet-deploy/stage-image.sh /absolute/path/fleet-dsh-context
context=/absolute/path/fleet-dsh-context
docker build --build-arg SOURCE_REVISION="$(cat "$context/source-revision")" \
  --tag fleet-dsh:qualified "$context"
~~~

## Configuration

Create a Fleet agent with kind `dsh`. The deployment's `fleet.json` has this
structure. Use the UUID assigned by Fleet and the configuration digest for
the deployed model, instructions, tool patches and credential revision.

~~~json
{
  "deploymentId": "12345678-0000-4000-8000-000000000001",
  "revision": "<64 lowercase hexadecimal digits>",
  "provider": "<configured DSH provider>",
  "model": "<configured DSH model>",
  "cwd": "/workspace",
  "patches": ["/etc/dsh/agent.patch.yml"],
  "port": 18433,
  "tokenFile": "/etc/dsh/fleet.token"
}
~~~

The native addon loads directly from the image. Its writable cache is disabled
so the temporary filesystem can remain non-executable.

The configuration directory is mounted read-only. Store the bearer token in
`fleet.token`. Fleet holds the same token by its own secret reference. Its
format is `fcd_<Fleet agent UUID>.<random 43 to 128 character secret>`.
Keep each provider credential file private and use a different secret for
each deployment. The workspace and data directory are writable by the
declared `DSH_UID_GID`. Keep those directories distinct across deployments.

Set `DSH_IMAGE`, `DSH_UID_GID`, `DSH_PROVIDER_ENV_FILE`, `DSH_CONFIG_DIR`,
`DSH_WORKSPACE_DIR`, `DSH_DATA_DIR`, `DSH_NETWORK_ALIAS` and `DSH_NETWORK` in
the Compose environment file. Create the dedicated network before launch.
Use a separate environment file and project name for every DSH agent.

~~~bash
docker compose --project-name fleet-dsh-alpha --env-file /absolute/path/alpha.env \
  --file packages/sdk/server/fleet-deploy/compose.yaml up -d --wait
~~~

Fleet uses the origin (for example `http://dsh-alpha:18433`) and verifies the
deployment UUID and configuration revision before activation. To apply changes,
record the new configuration revision, restart the addressed deployment and
activate the revised configuration in Fleet.
