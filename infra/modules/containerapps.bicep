param prefix string
param location string
param tags object
param env string
param infrastructureSubnetId string
param logAnalyticsWorkspaceName string
@secure()
param appInsightsConnectionString string
param identityId string
param identityClientId string
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

// Secrets are stored in Key Vault and referenced by URL; the managed identity resolves them.
var kvSecrets = [
  { name: 'database-url', keyVaultUrl: '${kv}secrets/DATABASE-URL', identity: identityId }
  { name: 'bc-client-secret', keyVaultUrl: '${kv}secrets/BC-CLIENT-SECRET', identity: identityId }
  { name: 'vapid-private-key', keyVaultUrl: '${kv}secrets/VAPID-PRIVATE-KEY', identity: identityId }
  { name: 'web-pubsub-connection', keyVaultUrl: '${kv}secrets/WEB-PUBSUB-CONNECTION', identity: identityId }
  { name: 'appinsights-connection', value: appInsightsConnectionString }
]

var bcMockUrl = deployBcMock ? 'http://${prefix}-bcmock' : ''

var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'APP_ENV', value: env }
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection' }
]

var backendEnv = concat(commonEnv, [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'BC_MODE', value: bcMode }
  { name: 'BC_MOCK_URL', value: bcMockUrl }
  { name: 'BC_CLIENT_SECRET', secretRef: 'bc-client-secret' }
  { name: 'VAPID_PRIVATE_KEY', secretRef: 'vapid-private-key' }
  { name: 'WEB_PUBSUB_CONNECTION', secretRef: 'web-pubsub-connection' }
  { name: 'BLOB_ENDPOINT', value: storageBlobEndpoint }
  { name: 'APP_BASE_URL', value: appBaseUrl }
])

var registries = [
  {
    server: registryLoginServer
    identity: identityId
  }
]

var identityBlock = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${identityId}': {}
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-api'
  location: location
  tags: tags
  identity: identityBlock
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
      registries: registries
      secrets: kvSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registryLoginServer}/monteur-api:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: backendEnv
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
  identity: identityBlock
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      registries: registries
      secrets: kvSecrets
    }
    template: {
      containers: [
        {
          name: 'worker'
          // Same image as api, different entry point (src/worker.ts).
          image: '${registryLoginServer}/monteur-api:${imageTag}'
          command: ['node', 'dist/worker.js']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: backendEnv
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
  identity: identityBlock
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
      registries: registries
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
  identity: identityBlock
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
      registries: registries
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

output appFqdn string = app.properties.configuration.ingress.fqdn
output apiFqdn string = api.properties.configuration.ingress.fqdn
output environmentId string = cae.id
