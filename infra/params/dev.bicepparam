using '../main.bicep'

param env = 'dev'
param enableFrontDoor = false
param bcMode = 'mock'
// Entra group that administers PostgreSQL – fill in before the first deployment.
param postgresAdminGroupObjectId = '00000000-0000-0000-0000-000000000000'
param postgresAdminGroupName = 'grp-monteur-dev-pgadmin'
param appBaseUrl = ''
param imageTag = readEnvironmentVariable('IMAGE_TAG', 'latest')
