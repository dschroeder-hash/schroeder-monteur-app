using '../main.bicep'

param env = 'prod'
param enableFrontDoor = true
param bcMode = 'production'
// Entra group that administers PostgreSQL – fill in before the first deployment.
param postgresAdminGroupObjectId = '00000000-0000-0000-0000-000000000000'
param postgresAdminGroupName = 'grp-monteur-prod-pgadmin'
param appBaseUrl = ''
// Entra app registrations (API and SPA) – fill in before the first deployment (docs/BETRIEB.md).
param entraApiAudience = 'api://werkstatt-api-prod'
param entraClientId = '00000000-0000-0000-0000-000000000000'
// After the first deployment: frontDoorId of the Front Door profile (az afd profile show … --query frontDoorId).
param frontDoorId = ''
param imageTag = readEnvironmentVariable('IMAGE_TAG', 'latest')
