using '../main.bicep'

param env = 'prod'
param enableFrontDoor = true
param bcMode = 'production'
// Entra group that administers PostgreSQL – fill in before the first deployment.
param postgresAdminGroupObjectId = '00000000-0000-0000-0000-000000000000'
param postgresAdminGroupName = 'grp-monteur-prod-pgadmin'
param appBaseUrl = ''
param imageTag = readEnvironmentVariable('IMAGE_TAG', 'latest')
