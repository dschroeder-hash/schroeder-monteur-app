/// <summary>
/// Adds the idempotency key of the Monteur-App (app booking id) to "Item Journal Line".
/// A record with the same id is never created twice by the API pages.
/// </summary>
tableextension 50105 "WS Item Journal Line" extends "Item Journal Line"
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
