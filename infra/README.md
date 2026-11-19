# Infrastruktur (Bicep)

Alle Ressourcen der Monteur-App in **Germany West Central**, je Umgebung (dev / test / prod) eine eigene Ressourcengruppe.

## Aufbau

| Datei                         | Inhalt                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.bicep`                  | Einstieg (Scope: Ressourcengruppe), verdrahtet alle Module                                                                                       |
| `modules/monitoring.bicep`    | Log Analytics + Application Insights (IP-Maskierung an)                                                                                          |
| `modules/identity.bicep`      | User-assigned Managed Identity für alle Container Apps                                                                                           |
| `modules/network.bicep`       | VNet mit Subnetz für Container Apps (/23) und delegiertem Subnetz für PostgreSQL (/28)                                                           |
| `modules/registry.bicep`      | Azure Container Registry (dev/test Basic, prod Standard), AcrPull für die Identity                                                               |
| `modules/keyvault.bicep`      | Key Vault im RBAC-Modus, Purge Protection nur in prod, Audit-Logs                                                                                |
| `modules/postgres.bicep`      | PostgreSQL Flexible Server 16, privater Zugriff (VNet + Private DNS), nur Entra-Authentifizierung, Backups 7 Tage (dev/test) bzw. 35 Tage (prod) |
| `modules/storage.bicep`       | Storage Account privat, kein Shared Key, Container `photos`, Lifecycle-Platzhalter                                                               |
| `modules/webpubsub.bicep`     | Azure Web PubSub mit Hub `werkstatt`                                                                                                             |
| `modules/containerapps.bicep` | Container-Apps-Umgebung (VNet), Apps `app` (3000), `api` (4000), `worker` (ohne Ingress), `bcmock` (nur dev/test, intern)                        |
| `modules/frontdoor.bicep`     | Optional: Front Door Premium + WAF (`enableFrontDoor`)                                                                                           |
| `params/*.bicepparam`         | Parameter je Umgebung                                                                                                                            |

Namensschema: `schr-monteur-{env}-{Kürzel}` nach Cloud Adoption Framework (`-log`, `-appi`, `-id`, `-vnet`, `-psql`, `-wps`, `-cae`, `-api`, `-app`, `-worker`, `-afd`). Ressourcen ohne Bindestriche (Key Vault, Storage, Registry): `schrmont{env}kv|st|cr`.

### Hinweise

- **Geo-redundantes Backup ist aus.** Die Partnerregion von Germany West Central ist Germany North, die nur eingeschränkt verfügbar ist. Die Daten bleiben damit in Deutschland. In prod sorgt zonenredundante Hochverfügbarkeit für Ausfallsicherheit.
- **Fotos:** Die API stellt _User Delegation SAS_ (über die Managed Identity) aus, deshalb ist der Shared Key am Storage Account abgeschaltet. Die eigentliche Löschfrist setzt die App (Löschjob), die Lifecycle-Regel ist nur ein Platzhalter.
- **Secrets** liegen ausschließlich im Key Vault und werden von den Container Apps per URL referenziert: `DATABASE-URL`, `BC-CLIENT-SECRET`, `VAPID-PRIVATE-KEY`, `WEB-PUBSUB-CONNECTION`.
- **Worker** läuft mit genau einer Replik (Sync-Cursor und Zeitpläne).

## Voraussetzungen

- Azure CLI ≥ 2.60 mit Bicep (`az bicep install`)
- Rechte: _Owner_ oder _Contributor + User Access Administrator_ auf der Ressourcengruppe (Rollenzuweisungen werden angelegt)
- Entra-Gruppe für die PostgreSQL-Administration (Object-ID in `params/{env}.bicepparam` eintragen)

## Bereitstellung

```bash
az login
```

```bash
az group create --name rg-schr-monteur-dev --location germanywestcentral
```

```bash
az deployment group create --resource-group rg-schr-monteur-dev --parameters infra/params/dev.bicepparam
```

Mit Image-Tag (z. B. aus der Pipeline):

```bash
IMAGE_TAG=abc1234 az deployment group create --resource-group rg-schr-monteur-dev --parameters infra/params/dev.bicepparam
```

Vorab prüfen, was sich ändert:

```bash
az deployment group what-if --resource-group rg-schr-monteur-dev --parameters infra/params/dev.bicepparam
```

Reihenfolge beim **ersten** Deployment: Die Container Apps referenzieren Key-Vault-Secrets und Images, die es noch nicht gibt. Deshalb:

1. Deployment ausführen (Container Apps starten noch nicht sauber).
2. Secrets im Key Vault anlegen (siehe unten).
3. Images per Pipeline (`deploy.yml`) bauen und pushen, danach erneut deployen.

```bash
az keyvault secret set --vault-name schrmontdevkv --name DATABASE-URL --value "<connection string>"
```

## Manuelle Schritte (nicht in Bicep)

| Schritt                                           | Wer         | Beschreibung                                                                                                                           |
| ------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Entra App Registration „Monteur-App API“          | IT          | App Roles `Werkstatt.Monteur`, `Werkstatt.Meister`, `Werkstatt.Lager`, `Werkstatt.Personal`, `Werkstatt.Admin`; Scope `access_as_user` |
| Entra App Registration „Monteur-App Web“ (SPA)    | IT          | Redirect-URIs je Umgebung, API-Berechtigung auf „Monteur-App API“                                                                      |
| Entra App Registration „Monteur-App BC-Connector“ | IT          | Client Credentials für Business Central, Secret in Key Vault `BC-CLIENT-SECRET` (siehe `docs/SETUP-BC.md`)                             |
| Entra App Registration „GitHub Deploy“            | IT          | Federated Credentials für GitHub Actions (OIDC), Rollen auf den Ressourcengruppen                                                      |
| PostgreSQL-Rolle für die Managed Identity         | DBA         | `SELECT * FROM pgaadauth_create_principal('schr-monteur-{env}-id', false, false);` und Rechte auf DB `monteur`                         |
| DNS / eigene Domain                               | IT          | CNAME auf Front Door bzw. Container App, Zertifikat (verwaltet)                                                                        |
| VAPID-Schlüssel                                   | Entwicklung | `npx web-push generate-vapid-keys`, privater Schlüssel in Key Vault                                                                    |
