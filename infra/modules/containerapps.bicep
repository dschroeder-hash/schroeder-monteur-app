param prefix string
param location string
param tags object
param env string
param infrastructureSubnetId string
param logAnalyticsWorkspaceName string
@secure()
param appInsightsConnectionString string
@description('Identity of the API: database login member of monteur_app only.')
param apiIdentityId string
param apiIdentityClientId string
param apiIdentityName string
@description('Identity of the worker: database login member of monteur_worker.')
param workerIdentityId string
param workerIdentityClientId string
param workerIdentityName string
@description('Identity of the Next.js app and the BC mock: image pull only – no secrets, no data access.')
param appIdentityId string
@description('Identity of the migration job (Entra administrator of PostgreSQL, owns the schema).')
param migrateIdentityId string
param migrateIdentityClientId string
param migrateIdentityName string
param entraTenantId string
param entraApiAudience string
param entraClientId string
param postgresHost string
param frontDoorId string
param bcApiBaseUrl string = ''
param bcTokenUrl string = ''
param bcClientId string = ''
param vapidPublicKey string = ''
param webPubSubEndpoint string = ''
param registryLoginServer string
param keyVaultUri string
param storageBlobEndpoint string
param imageTag string
param deployBcMock bool
param bcMode string
param appBaseUrl string
param zoneRedundant bool

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: zoneRedundant
  }
}

var kv = endsWith(keyVaultUri, '/') ? keyVaultUri : '${keyVaultUri}/'

// Secrets stay in Key Vault, referenced by URL and resolved with the component's own identity (E-57).
// The database needs no secret: api/worker log in with an Entra token of their identity (DATABASE_AUTH=entra).
func backendSecrets(identity string, kvUri string, appInsights string) array => [
  { name: 'bc-client-secret', keyVaultUrl: '${kvUri}secrets/BC-CLIENT-SECRET', identity: identity }
  { name: 'vapid-private-key', keyVaultUrl: '${kvUri}secrets/VAPID-PRIVATE-KEY', identity: identity }
  { name: 'appinsights-connection', value: appInsights }
]

func registriesFor(server string, identity string) array => [
  {
    server: server
    identity: identity
  }
]

func identityOf(id string) object => {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${id}': {}
  }
}

var bcMockBase = 'http://${prefix}-bcmock'

var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'APP_ENV', value: env }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection' }
]

// Names exactly as read by api/src/config.ts.
var sharedBackendEnv = [
  { name: 'DATABASE_AUTH', value: 'entra' }
  { name: 'BC_CLIENT_SECRET', secretRef: 'bc-client-secret' }
  { name: 'VAPID_PRIVATE_KEY', secretRef: 'vapid-private-key' }
  { name: 'AUTH_MODE', value: 'entra' }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_API_AUDIENCE', value: entraApiAudience }
  { name: 'ENTRA_ALLOWED_CLIENT_IDS', value: entraClientId }
  { name: 'CORS_ORIGINS', value: appBaseUrl }
  { name: 'PUBLIC_API_URL', value: appBaseUrl }
  { name: 'STORAGE_MODE', value: 'azure' }
  { name: 'STORAGE_ACCOUNT_URL', value: storageBlobEndpoint }
  { name: 'BC_MODE', value: bcMode }
  { name: 'BC_API_BASE_URL', value: bcMode == 'mock' ? '${bcMockBase}/api' : bcApiBaseUrl }
  { name: 'BC_TOKEN_URL', value: bcMode == 'mock' ? '${bcMockBase}/oauth2/token' : bcTokenUrl }
  { name: 'BC_CLIENT_ID', value: bcMode == 'mock' ? 'mock' : bcClientId }
  { name: 'VAPID_PUBLIC_KEY', value: vapidPublicKey }
  { name: 'WEB_PUBSUB_ENDPOINT', value: webPubSubEndpoint }
  { name: 'FRONT_DOOR_ID', value: frontDoorId }
  // Front Door + Container Apps ingress in front of the API (client IP for rate limits).
  { name: 'TRUST_PROXY_HOPS', value: empty(frontDoorId) ? '1' : '2' }
]

// Database login = name of the component's managed identity (created in PostgreSQL, see docs/BETRIEB.md).
var apiEnv = concat(commonEnv, sharedBackendEnv, [
  { name: 'AZURE_CLIENT_ID', value: apiIdentityClientId }
  { name: 'DATABASE_URL', value: 'postgres://${apiIdentityName}@${postgresHost}:5432/monteur?sslmode=require' }
])
var workerEnv = concat(commonEnv, sharedBackendEnv, [
  { name: 'AZURE_CLIENT_ID', value: workerIdentityClientId }
  { name: 'DATABASE_URL', value: 'postgres://${workerIdentityName}@${postgresHost}:5432/monteur?sslmode=require' }
])

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-api'
  location: location
  tags: tags
  identity: identityOf(apiIdentityId)
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
      }
      registries: registriesFor(registryLoginServer, apiIdentityId)
      secrets: backendSecrets(apiIdentityId, kv, appInsightsConnectionString)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registryLoginServer}/monteur-api:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: apiEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 4000 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 4000 }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: env == 'prod' ? 2 : 0
        maxReplicas: env == 'prod' ? 6 : 2
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-worker'
  location: location
  tags: tags
  identity: identityOf(workerIdentityId)
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      registries: registriesFor(registryLoginServer, workerIdentityId)
      secrets: backendSecrets(workerIdentityId, kv, appInsightsConnectionString)
    }
    template: {
      containers: [
        {
          name: 'worker'
          // Same image as api, different entry point (src/worker.ts).
          image: '${registryLoginServer}/monteur-api:${imageTag}'
          command: ['node', 'dist/worker.js']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: workerEnv
        }
      ]
      // Exactly one worker: BC sync cursors and cron jobs assume a single scheduler;
      // the transfer queue itself is safe for more (SKIP LOCKED).
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-app'
  location: location
  tags: tags
  identity: identityOf(appIdentityId)
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: registriesFor(registryLoginServer, appIdentityId)
      secrets: [
        { name: 'appinsights-connection', value: appInsightsConnectionString }
      ]
    }
    template: {
      containers: [
        {
          name: 'app'
          image: '${registryLoginServer}/monteur-app:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, [
            { name: 'API_BASE_URL', value: 'https://${api.properties.configuration.ingress.fqdn}' }
          ])
        }
      ]
      scale: {
        minReplicas: env == 'prod' ? 2 : 0
        maxReplicas: env == 'prod' ? 4 : 2
      }
    }
  }
}

resource bcMock 'Microsoft.App/containerApps@2024-03-01' = if (deployBcMock) {
  name: '${prefix}-bcmock'
  location: location
  tags: tags
  identity: identityOf(appIdentityId)
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      // Internal only: reachable from api/worker inside the environment.
      ingress: {
        external: false
        targetPort: 4100
        transport: 'auto'
      }
      registries: registriesFor(registryLoginServer, appIdentityId)
    }
    template: {
      containers: [
        {
          name: 'bcmock'
          image: '${registryLoginServer}/monteur-bcmock:${imageTag}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'PORT', value: '4100' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// Migrations + database logins (OP-37): started by the pipeline before every rollout (manual trigger), idempotent.
resource migrationJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${prefix}-migrate'
  location: location
  tags: tags
  identity: identityOf(migrateIdentityId)
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 1
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: registriesFor(registryLoginServer, migrateIdentityId)
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${registryLoginServer}/monteur-api:${imageTag}'
          command: ['node', 'dist/db/migrate.js']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'AZURE_CLIENT_ID', value: migrateIdentityClientId }
            { name: 'DATABASE_AUTH', value: 'entra' }
            { name: 'DATABASE_URL', value: 'postgres://${migrateIdentityName}@${postgresHost}:5432/monteur?sslmode=require' }
            { name: 'DB_API_LOGIN', value: apiIdentityName }
            { name: 'DB_WORKER_LOGIN', value: workerIdentityName }
          ]
        }
      ]
    }
  }
}

output migrationJobName string = migrationJob.name
output appFqdn string = app.properties.configuration.ingress.fqdn
output apiFqdn string = api.properties.configuration.ingress.fqdn
output environmentId string = cae.id
