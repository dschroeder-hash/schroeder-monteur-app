/// <summary>
/// Adds the idempotency key of the Monteur-App (app booking id) to "Res. Journal Line".
/// A record with the same id is never created twice by the API pages.
/// </summary>
tableextension 50104 "WS Res. Journal Line" extends "Res. Journal Line"
{
    fields
    {
        field(50100; "Monteur App Id"; Guid)
        {
            Caption = 'Monteur-App-ID';
            DataClassification = SystemMetadata;
        }
    }

    keys
    {
        key(WSMonteurAppId; "Monteur App Id")
        {
        }
    }
}
