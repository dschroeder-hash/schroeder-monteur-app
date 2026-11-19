/// <summary>
/// Adds the idempotency key of the Monteur-App (app booking id) to "Service Order Allocation".
/// A record with the same id is never created twice by the API pages.
/// </summary>
tableextension 50101 "WS Service Order Allocation" extends "Service Order Allocation"
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
