param name string
param location string
param tags object
param delegatedSubnetId string
param vnetId string
param tenantId string
param adminGroupObjectId string
param adminGroupName string
@description('Identity of the migration job – second Entra administrator, owns the schema (OP-37).')
param migrationPrincipalId string
param migrationPrincipalName string
param skuName string
param skuTier string
param storageSizeGB int
param backupRetentionDays int
param highAvailability bool

resource dnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${name}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: dnsZone
  name: 'vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnetId }
  }
}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: '16'
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      // Geo-redundant backup stays off: the paired region of Germany West Central is
      // Germany North, which has restricted access. Data residency remains in Germany.
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: highAvailability ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: dnsZone.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenantId
    }
  }
  dependsOn: [dnsLink]
}

// Extensions used by the migrations (trigram index for item search) must be allow-listed on Azure.
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: {
    value: 'PG_TRGM'
    source: 'user-override'
  }
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: adminGroupObjectId
  properties: {
    principalType: 'Group'
    principalName: adminGroupName
    tenantId: tenantId
  }
}

// Administrators can only be added one after another.
resource migrationAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: migrationPrincipalId
  dependsOn: [admin]
  properties: {
    principalType: 'ServicePrincipal'
    principalName: migrationPrincipalName
    tenantId: tenantId
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'monteur'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource tz 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'timezone'
  properties: {
    value: 'UTC'
    source: 'user-override'
  }
}

output fqdn string = server.properties.fullyQualifiedDomainName
output id string = server.id
